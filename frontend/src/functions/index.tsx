import type { ComponentType } from 'react'
import { Des } from './Des'
import { Eco } from './Eco'
import { Fa } from './Fa'
import { Fil } from './Fil'
import { Fx } from './Fx'
import { Gp } from './Gp'
import { Help } from './Help'
import { Hp } from './Hp'
import { Monitor } from './Monitor'
import { News } from './News'
import type { FunctionCode } from './registry'
import { Sov } from './Sov'
import type { FnProps } from './types'
import { Watchlist } from './Watchlist'
import { Yc } from './Yc'

export const COMPONENTS: Record<FunctionCode, ComponentType<FnProps>> = {
  DES: Des,
  GP: Gp,
  HP: Hp,
  FA: Fa,
  NEWS: News,
  FIL: Fil,
  WEI: (p) => <Monitor {...p} id="WEI" />,
  CMDTY: (p) => <Monitor {...p} id="CMDTY" />,
  WL: Watchlist,
  FX: Fx,
  YC: Yc,
  SOV: Sov,
  ECO: Eco,
  HELP: Help,
}
