import type { ComponentType } from 'react'
import { Bond } from './Bond'
import { Comp } from './Comp'
import { Dcf } from './Dcf'
import { Des } from './Des'
import { Dvd } from './Dvd'
import { Eco } from './Eco'
import { Ern } from './Ern'
import { Fa } from './Fa'
import { Fil } from './Fil'
import { Fx } from './Fx'
import { Gp } from './Gp'
import { Help } from './Help'
import { Hp } from './Hp'
import { Ivol } from './Ivol'
import { Monitor } from './Monitor'
import { Most } from './Most'
import { News } from './News'
import { Omon } from './Omon'
import { Port } from './Port'
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
  DCF: Dcf,
  COMP: Comp,
  ERN: Ern,
  DVD: Dvd,
  MOST: Most,
  OMON: Omon,
  IVOL: Ivol,
  BOND: Bond,
  PORT: Port,
  WEI: (p) => <Monitor {...p} id="WEI" />,
  CMDTY: (p) => <Monitor {...p} id="CMDTY" />,
  WL: Watchlist,
  FX: Fx,
  YC: Yc,
  SOV: Sov,
  ECO: Eco,
  HELP: Help,
}
