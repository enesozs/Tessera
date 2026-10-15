"""The ASK loop against a scripted fake client — no network, no API key."""

from types import SimpleNamespace as NS

import pytest

from tessera import assistant
from tessera.models import Envelope, Provenance
from tessera.providers import yahoo


def text(t):
    return NS(type="text", text=t)


def tool_use(id_, name, input_):
    return NS(type="tool_use", id=id_, name=name, input=input_)


def reply(content, stop):
    return NS(
        content=content,
        stop_reason=stop,
        model="claude-opus-5-5",
        usage=NS(input_tokens=100, output_tokens=20, cache_read_input_tokens=80),
    )


class FakeClient:
    def __init__(self, replies):
        self.replies = list(replies)
        self.requests = []
        self.beta = NS(messages=NS(create=self.create))

    def create(self, **kwargs):
        # Snapshot: the loop keeps appending to the same messages list after each call.
        self.requests.append({**kwargs, "messages": list(kwargs["messages"])})
        return self.replies.pop(0)


@pytest.fixture
def fake_profile(monkeypatch):
    def profile(symbol):
        data = yahoo.Profile.model_construct(**{f: None for f in yahoo.Profile.model_fields})
        data.symbol, data.name, data.price, data.trailing_pe = symbol, "Ferrari N.V.", 397.4, 36.8
        return Envelope(data=data, meta=Provenance(source="Yahoo Finance", freshness="delayed"))

    monkeypatch.setattr(yahoo, "profile", profile)


def test_loop_runs_tools_in_parallel_and_records_a_trace(fake_profile):
    client = FakeClient(
        [
            reply(
                [
                    tool_use("t1", "get_profile", {"symbol": "race"}),
                    tool_use("t2", "no_such_tool", {}),
                ],
                "tool_use",
            ),
            reply([text("Ferrari trades at 36.8× earnings [Yahoo Finance].")], "end_turn"),
        ]
    )
    out = assistant.ask("Is Ferrari expensive?", security="RACE", client=client).data
    assert out.answer.startswith("Ferrari trades at 36.8×")
    assert [c.tool for c in out.tool_calls] == ["get_profile", "no_such_tool"]
    assert out.tool_calls[0].ok and out.tool_calls[0].source == "Yahoo Finance"
    assert not out.tool_calls[1].ok
    # Both results go back in ONE user message, errors flagged, ids matched.
    results = client.requests[1]["messages"][-1]["content"]
    assert [r["tool_use_id"] for r in results] == ["t1", "t2"]
    assert [r["is_error"] for r in results] == [False, True]
    assert '"trailing_pe":36.8' in results[0]["content"]
    # Context and request shape.
    first = client.requests[0]
    assert "looking at RACE" in first["messages"][0]["content"]
    assert first["fallbacks"] == "default" and first["betas"] == [assistant.FALLBACK_BETA]
    assert all(
        t["strict"] and t["input_schema"]["additionalProperties"] is False for t in first["tools"]
    )
    assert (out.input_tokens, out.output_tokens, out.cache_read_tokens) == (200, 40, 160)


def test_refusals_are_reported_not_parsed():
    client = FakeClient([reply([], "refusal")])
    out = assistant.ask("…", client=client).data
    assert out.stop_reason == "refusal" and "declined" in out.answer


def test_tool_budget_ends_with_a_forced_answer(fake_profile, monkeypatch):
    monkeypatch.setattr(assistant, "MAX_STEPS", 2)
    loop = [
        reply([tool_use(f"t{i}", "get_profile", {"symbol": "RACE"})], "tool_use") for i in range(2)
    ]
    client = FakeClient([*loop, reply([text("Best answer so far.")], "end_turn")])
    out = assistant.ask("Keep digging", client=client).data
    assert out.answer == "Best answer so far."
    assert len(client.requests) == 3
    assert client.requests[2]["messages"][-1]["role"] == "system"  # budget notice


def test_every_tool_has_a_handler():
    assert {t["name"] for t in assistant.TOOLS} == set(assistant.HANDLERS)


def test_missing_credentials_become_a_configuration_error():
    from tessera.errors import ConfigurationError

    class NoAuth(FakeClient):
        def create(self, **kwargs):
            raise TypeError('"Could not resolve authentication method. Expected one of api_key…"')

    with pytest.raises(ConfigurationError, match="ANTHROPIC_API_KEY"):
        assistant.ask("Hello there", client=NoAuth([]))
