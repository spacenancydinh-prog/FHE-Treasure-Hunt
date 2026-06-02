// ABI extracted from out/TreasureHunt.sol/TreasureHunt.json
// InEuint8 struct: { ctHash: uint256, securityZone: uint8, utype: uint8, signature: bytes }

const IN_EUINT8 = [
  { name: 'ctHash', type: 'uint256' },
  { name: 'securityZone', type: 'uint8' },
  { name: 'utype', type: 'uint8' },
  { name: 'signature', type: 'bytes' },
] as const

export const TREASURE_HUNT_ABI = [
  // ── Write functions ──────────────────────────────────────────────────────
  {
    type: 'function', name: 'setTreasure', stateMutability: 'nonpayable',
    inputs: [
      { name: 'x', type: 'tuple', components: IN_EUINT8 },
      { name: 'y', type: 'tuple', components: IN_EUINT8 },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'joinGame', stateMutability: 'payable',
    inputs: [], outputs: [],
  },
  {
    type: 'function', name: 'move', stateMutability: 'nonpayable',
    inputs: [
      { name: 'x', type: 'tuple', components: IN_EUINT8 },
      { name: 'y', type: 'tuple', components: IN_EUINT8 },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'checkProximity', stateMutability: 'nonpayable',
    inputs: [], outputs: [{ name: '', type: 'bytes32' }],  // euint8 = bytes32
  },
  {
    type: 'function', name: 'prepareWinClaim', stateMutability: 'nonpayable',
    inputs: [
      { name: 'x', type: 'tuple', components: IN_EUINT8 },
      { name: 'y', type: 'tuple', components: IN_EUINT8 },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'finalizeWinClaim', stateMutability: 'nonpayable',
    inputs: [
      { name: 'result', type: 'bool' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'resetGame', stateMutability: 'nonpayable',
    inputs: [], outputs: [],
  },
  // ── View functions ───────────────────────────────────────────────────────
  { type: 'function', name: 'getLastBucket', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'getGameState',  stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'getPot',         stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getPlayerCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getMoveCount',   stateMutability: 'view', inputs: [{ name: 'player', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'hasJoined',      stateMutability: 'view', inputs: [{ name: 'player', type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'owner',          stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'winner',         stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'pendingClaimer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'treasureSet',    stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'pot',            stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'playerCount',    stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  // ── Events ───────────────────────────────────────────────────────────────
  { type: 'event', name: 'GameCreated',      inputs: [{ name: 'owner',       type: 'address', indexed: true }] },
  { type: 'event', name: 'PlayerJoined',     inputs: [{ name: 'player',      type: 'address', indexed: true }, { name: 'playerCount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'PlayerMoved',      inputs: [{ name: 'player',      type: 'address', indexed: true }] },
  { type: 'event', name: 'ProximityChecked', inputs: [{ name: 'player',      type: 'address', indexed: true }] },
  { type: 'event', name: 'WinClaimPrepared', inputs: [{ name: 'claimer',     type: 'address', indexed: true }] },
  { type: 'event', name: 'GameWon',          inputs: [{ name: 'winner',      type: 'address', indexed: true }] },
  { type: 'event', name: 'GameReset',        inputs: [] },
  // ── Errors ───────────────────────────────────────────────────────────────
  { type: 'error', name: 'InvalidEncryptedInput',   inputs: [{ name: 'got', type: 'uint8' }, { name: 'expected', type: 'uint8' }] },
  { type: 'error', name: 'SecurityZoneOutOfBounds',  inputs: [{ name: 'value', type: 'int32' }] },
] as const
