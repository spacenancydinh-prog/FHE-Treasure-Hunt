import { parseEther } from 'viem'

export const CONTRACT_ADDRESS = (import.meta.env.VITE_CONTRACT_ADDRESS ?? '0x59C161D28aF2D8f5929FC1bEDCCC3dae12dbDA54') as `0x${string}`

export const ENTRY_FEE = parseEther('0.01')

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const
