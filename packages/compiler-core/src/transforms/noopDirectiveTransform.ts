import { DirectiveTransform } from '../transform'

/**
 * 空指令
 * @returns 
 */
export const noopDirectiveTransform: DirectiveTransform = () => ({ props: [] })
