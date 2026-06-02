const IN_EUINT8 = [
  { name: 'ctHash',       type: 'uint256' },
  { name: 'securityZone', type: 'uint8'   },
  { name: 'utype',        type: 'uint8'   },
  { name: 'signature',    type: 'bytes'   },
] as const

export const TREASURE_HUNT_ABI = [
  // ── Write ──
  { type: 'function', name: 'setTreasure',      stateMutability: 'nonpayable', inputs: [{ name: 'x', type: 'tuple', components: IN_EUINT8 }, { name: 'y', type: 'tuple', components: IN_EUINT8 }], outputs: [] },
  { type: 'function', name: 'joinGame',          stateMutability: 'payable',    inputs: [], outputs: [] },
  { type: 'function', name: 'move',              stateMutability: 'nonpayable', inputs: [{ name: 'x', type: 'tuple', components: IN_EUINT8 }, { name: 'y', type: 'tuple', components: IN_EUINT8 }], outputs: [] },
  { type: 'function', name: 'checkProximity',    stateMutability: 'nonpayable', inputs: [], outputs: [{ name: '', type: 'bytes32' }] },
  { type: 'function', name: 'prepareWinClaim',   stateMutability: 'nonpayable', inputs: [{ name: 'x', type: 'tuple', components: IN_EUINT8 }, { name: 'y', type: 'tuple', components: IN_EUINT8 }], outputs: [] },
  { type: 'function', name: 'finalizeWinClaim',  stateMutability: 'nonpayable', inputs: [{ name: 'result', type: 'bool' }, { name: 'signature', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'resetGame',           stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'authorizeBurner',    stateMutability: 'nonpayable', inputs: [{ name: 'burner', type: 'address' }], outputs: [] },
  { type: 'function', name: 'cancelPendingClaim', stateMutability: 'nonpayable', inputs: [{ name: 'claimer', type: 'address' }], outputs: [] },
  { type: 'function', name: 'burnerToPlayer',    stateMutability: 'view', inputs: [{ name: 'burner', type: 'address' }], outputs: [{ name: '', type: 'address' }] },
  // ── View ──
  { type: 'function', name: 'getLastBucket',     stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bytes32' }] },
  { type: 'function', name: 'getGameState',      stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8'   }] },
  { type: 'function', name: 'getPot',            stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'getPlayerCount',    stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'getMoveCount',      stateMutability: 'view', inputs: [{ name: 'player', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'hasJoined',         stateMutability: 'view', inputs: [{ name: 'player', type: 'address' }], outputs: [{ name: '', type: 'bool'    }] },
  { type: 'function', name: 'owner',             stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'winner',            stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'hasPendingClaim',   stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { type: 'function', name: 'treasureSet',       stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool'    }] },
  { type: 'function', name: 'pot',               stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'playerCount',       stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  // ── Events ──
  { type: 'event', name: 'GameCreated',      inputs: [{ name: 'owner',       type: 'address', indexed: true  }] },
  { type: 'event', name: 'PlayerJoined',     inputs: [{ name: 'player',      type: 'address', indexed: true  }, { name: 'playerCount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'PlayerMoved',      inputs: [{ name: 'player',      type: 'address', indexed: true  }] },
  { type: 'event', name: 'ProximityChecked', inputs: [{ name: 'player',      type: 'address', indexed: true  }] },
  { type: 'event', name: 'WinClaimPrepared', inputs: [{ name: 'claimer',     type: 'address', indexed: true  }] },
  { type: 'event', name: 'ClaimFailed',      inputs: [{ name: 'claimer',     type: 'address', indexed: true  }] },
  { type: 'event', name: 'BurnerAuthorized', inputs: [{ name: 'player',      type: 'address', indexed: true  }, { name: 'burner', type: 'address', indexed: true }] },
  { type: 'event', name: 'GameWon',          inputs: [{ name: 'winner',      type: 'address', indexed: true  }] },
  { type: 'event', name: 'GameReset',        inputs: [] },
  // ── Errors ──
  { type: 'error', name: 'InvalidEncryptedInput',  inputs: [] },
  { type: 'error', name: 'SecurityZoneOutOfBounds', inputs: [] },
] as const
