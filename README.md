# FHE Treasure Hunt

A fully on-chain multiplayer treasure hunt where **all player positions and the treasure coordinate are encrypted end-to-end using Fully Homomorphic Encryption (FHE)**. No server, no oracle, no trusted intermediary — the contract computes proximity on ciphertext, and only the individual player can decrypt their own proximity reading.

**Live demo:** [https://frontend-one-wheat-31.vercel.app](https://frontend-one-wheat-31.vercel.app)  
**Contract (Ethereum Sepolia):** [`0x59C161D28aF2D8f5929FC1bEDCCC3dae12dbDA54`](https://sepolia.etherscan.io/address/0x59C161D28aF2D8f5929FC1bEDCCC3dae12dbDA54)

---

## Table of Contents

- [How FHE Is Used](#how-fhe-is-used)
- [Game Flow](#game-flow)
- [Architecture](#architecture)
- [Smart Contract](#smart-contract)
- [Frontend](#frontend)
- [Security](#security)
- [Local Development](#local-development)

---

## How FHE Is Used

FHE allows arithmetic to be performed directly on encrypted data without decrypting it first. This project uses [Fhenix CoFHE](https://github.com/fhenixprotocol/cofhe-contracts) (`@fhenixprotocol/cofhe-contracts@0.1.3`), a threshold-FHE system where:

- **`euint8`** / **`ebool`** are the core FHE types — both are `bytes32` handles pointing to ciphertext managed by the CoFHE Task Manager network.
- Every encrypted value requires explicit ACL grants (`FHE.allowThis`, `FHE.allowSender`, `FHE.allow`) before it can be decrypted by anyone.
- Decryption is **asynchronous** and requires two separate transactions: one to trigger decryption off-chain, one to submit the proof on-chain.

### What stays encrypted

| Data | Type | Who can decrypt |
|------|------|----------------|
| Treasure X, Y | `euint8` | Nobody (never decrypted) |
| Player position X, Y | `euint8` | Nobody (used only in FHE ops) |
| Proximity bucket | `euint8` | Only the querying player |
| Win claim result | `ebool` | Only the claimer (via `decryptForTx`) |

### FHE proximity computation

The contract computes Manhattan distance entirely on ciphertext using the `FHE.select` / `FHE.sub` pattern to avoid `euint8` underflow:

```solidity
euint8 dx = FHE.select(
    FHE.gte(pxVal, txVal),
    FHE.sub(pxVal, txVal),   // px >= tx → px - tx
    FHE.sub(txVal, pxVal)    // tx > px  → tx - px
);
euint8 dy = FHE.select(FHE.gte(pyVal, tyVal), FHE.sub(pyVal, tyVal), FHE.sub(tyVal, pyVal));
euint8 distance = FHE.add(dx, dy);
```

The result is bucketed into 4 levels — still encrypted, sealed to the requesting player:

| Bucket | Label | Manhattan distance |
|--------|-------|--------------------|
| 3 | HOT | ≤ 2 |
| 2 | WARM | 3 – 5 |
| 1 | COLD | 6 – 8 |
| 0 | FROZEN | > 8 |

---

## Game Flow

```
1. Players JOIN (≥ 2 required, each pays 0.01 ETH entry fee)
   └─ setTreasure() is locked until MIN_PLAYERS reached

2. Owner calls setTreasure(encX, encY) → game transitions WAITING → ACTIVE
   └─ Treasure coordinates encrypted client-side via @cofhe/sdk before TX

3. Players move on a 16×16 grid — each move() encrypts new X,Y coords
   └─ Burner wallet path: moves sent without MetaMask popup (see below)

4. Players call checkProximity() (costs gas) → sealed euint8 bucket returned
   └─ Frontend calls getLastBucket() then decrypts via decryptForView(handle, FheTypes.Uint8)

5. Win claim — 2-transaction pattern:
   TX 1: prepareWinClaim(encX, encY)
         → on-chain FHE computes ebool isOnTreasure, stored as pending
         → emits WinClaimPrepared(claimer)
   OFF-CHAIN: SDK calls decryptForTx(handle).withPermit().execute()
         → returns { result: bool, signature: bytes }
   TX 2: finalizeWinClaim(result, signature)
         → FHE.verifyDecryptResult() validates the CoFHE network's signature
         → if result == true: pot transferred to winner (CEI pattern)
         → if result == false: hasPendingClaim cleared, ClaimFailed emitted
```

### Why 2 transactions for win claim?

FHE decryption is asynchronous — the Fhenix network must compute the threshold decryption off-chain between TX1 and TX2. The contract cannot call `getDecryptResult()` in the same transaction that triggered decryption. The `FHE.verifyDecryptResult()` call in TX2 ensures the plaintext result is cryptographically bound to the on-chain ciphertext handle — it cannot be spoofed.

---

## Architecture

```
fhe-treasure-hunt/
├── smartcontract/
│   ├── src/TreasureHunt.sol          # Core FHE game contract
│   ├── test/                         # Foundry tests (CofheTest base)
│   ├── script/                       # Deployment scripts
│   └── foundry.toml                  # Solidity 0.8.25, code_size_limit=100000
├── frontend/
│   ├── src/
│   │   ├── components/screens/
│   │   │   ├── LobbyScreen.tsx       # Wallet connect, join, owner panel
│   │   │   ├── GameBoard.tsx         # 16×16 grid, movement, scan, claim
│   │   │   └── VictoryScreen.tsx     # Winner display, prize amount
│   │   ├── hooks/
│   │   │   ├── useGameState.ts       # Multicall polling, localStorage cache
│   │   │   ├── useFHEEncrypt.ts      # @cofhe/sdk init, encrypt, decrypt
│   │   │   ├── useGameContract.ts    # All write TXs (join, move, claim)
│   │   │   └── useBurnerWallet.ts    # Deterministic session key, gas-optimized moves
│   │   ├── lib/
│   │   │   ├── abi.ts                # Full contract ABI
│   │   │   ├── contract.ts           # Deployed address constant
│   │   │   └── wagmi.ts              # 5-RPC fallback with rank:true auto-benchmark
│   │   └── context/
│   │       └── ToastContext.tsx      # Global TX error toasts
│   └── vercel.json                   # Build config (legacy-peer-deps for FHE SDK)
└── CLAUDE.md                         # AI coding instructions
```

### Tech stack

| Layer | Technology |
|-------|-----------|
| Smart contract | Solidity 0.8.25 + Fhenix CoFHE `@fhenixprotocol/cofhe-contracts@0.1.3` |
| Build tool | Foundry 1.5.1 + `@cofhe/foundry-plugin` (mock FHE for tests) |
| Network | Ethereum Sepolia (chainId 11155111) |
| Frontend | React 18 + Vite + TypeScript |
| Wallet | wagmi v3 + viem |
| FHE client | `@cofhe/sdk@0.5.2` (browser import: `@cofhe/sdk/web`) |
| Styling | CSS Modules — terminal/cyberpunk design system |
| RPC | Alchemy Sepolia (primary) + 4 public fallbacks, auto-benchmarked |
| Deployment | Vercel (frontend) |

---

## Smart Contract

### State variables

```solidity
// Encrypted treasure — never decrypted, used only in FHE ops
euint8 private treasureX;
euint8 private treasureY;

// Per-player encrypted position (updated on every move)
mapping(address => euint8) private playerX;
mapping(address => euint8) private playerY;

// Sealed proximity result — only owner can decrypt via decryptForView
mapping(address => euint8) private playerLastBucket;

// Win claim: 2-TX pattern (TX1 stores handle, TX2 verifies proof)
// NOTE: pendingClaimResult mapping base is at storage slot 13 — must not reorder above vars
mapping(address => ebool) private pendingClaimResult;
mapping(address => bool)  public  hasPendingClaim;

// Burner wallet delegation
mapping(address => address) public burnerToPlayer; // burner → player
mapping(address => address) public playerToBurner; // player → burner (for cleanup on reset)
```

### Key design decisions

**No global claim lock.** Original design used `address public pendingClaimer` — a single pending claim blocked all other players. Replaced with `mapping(address => bool) hasPendingClaim` so multiple players can run TX1 simultaneously without blocking each other.

**CEI pattern for prize transfer.** `pot = 0` and `winner = msg.sender` are set before the external `call{value: prize}`. This prevents reentrancy.

**Burner auth is reversible.** `authorizeBurner()` clears the previous mapping before registering a new burner key. `resetGame()` clears all `burnerToPlayer` and `playerToBurner` entries.

**Wrong-coord claim emits event, never reverts.** `finalizeWinClaim(false, sig)` clears `hasPendingClaim[msg.sender]` and emits `ClaimFailed` — the player can keep searching. This avoids the bug where TX2 never called leaves the mapping permanently dirty.

### Contract functions summary

| Function | Access | Description |
|----------|--------|-------------|
| `joinGame()` | Public, payable | Pay 0.01 ETH entry fee, register as player |
| `setTreasure(InEuint8 x, InEuint8 y)` | Owner only | Encrypt + store treasure, start game |
| `move(InEuint8 x, InEuint8 y)` | Player or authorized burner | Update encrypted position |
| `checkProximity()` | Player only | Compute + seal proximity bucket |
| `getLastBucket()` | Player only | Fetch sealed euint8 handle for off-chain decrypt |
| `prepareWinClaim(InEuint8 x, InEuint8 y)` | Player only, TX1 | FHE-compute win condition, store ebool handle |
| `finalizeWinClaim(bool result, bytes sig)` | Player only, TX2 | Verify CoFHE signature, transfer pot if winner |
| `authorizeBurner(address burner)` | Player only | Delegate moves to a local burner key |
| `cancelPendingClaim(address claimer)` | Owner only | Unstick a player whose TX2 was never sent |
| `resetGame()` | Owner only | Full reset after ENDED state |

---

## Frontend

### FHE encryption flow (`useFHEEncrypt.ts`)

Coordinates are never sent to the contract in plaintext. Before any `move()`, `setTreasure()`, or `prepareWinClaim()` call:

```typescript
// Lazy-init CoFHE client — creates self-permit on first use
const fhe = await initFHE()                      // @cofhe/sdk/web

// Encrypt two uint8 values into InEuint8 structs (bytes proof + handle)
const [encX, encY] = await fhe.encryptInputs([
  Encryptable.uint8(BigInt(x)),
  Encryptable.uint8(BigInt(y)),
]).execute()

// These are passed directly as calldata to the contract function
```

### Proximity decryption flow

```typescript
// 1. Send checkProximity() TX (costs gas, runs FHE on-chain)
// 2. After TX confirms, read the sealed handle:
const handle = await readContract({ functionName: 'getLastBucket', account: playerAddress })
// 3. Decrypt off-chain using the SDK permit:
const bucket = await fhe.decryptForView(BigInt(handle), FheTypes.Uint8).withPermit().execute()
// bucket ∈ {0, 1, 2, 3} → FROZEN / COLD / WARM / HOT
```

`getLastBucket()` requires `account: playerAddress` because the function has `require(players[msg.sender])`. Public calls with `address(0)` revert.

### Burner wallet (`useBurnerWallet.ts`)

The burner wallet eliminates MetaMask popups for every move while preserving security:

**Key derivation — deterministic, no storage:**
```typescript
// User signs a fixed message with MetaMask (free, no TX)
const sig = await signMessageAsync({ message: buildSignMessage(playerAddress) })
// Burner private key = keccak256 of the signature — same wallet always produces same key
const burnerKey = keccak256(toBytes(sig))
```

The key is never written to `localStorage` or `sessionStorage`. If the user refreshes, they re-sign the same message and get the same key.

**3-step session flow:**
1. **DERIVE** — MetaMask signs fixed message, burner key computed client-side
2. **REGISTER** — One MetaMask TX: `authorizeBurner(burnerAddress)` maps burner → player on-chain
3. **ACTIVE** — All moves sent from burner wallet with optimized gas settings

**Gas optimization:**
```typescript
const block = await publicClient.getBlock({ blockTag: 'latest' })
const baseFee = block.baseFeePerGas ?? parseGwei('2')
maxPriorityFeePerGas: parseGwei('1')               // Minimal tip
maxFeePerGas: baseFee * 15n / 10n + parseGwei('1') // baseFee × 1.5 + 1 gwei
```

FHE `move()` uses ~300–500k gas fixed (ZK proof verification). Only gas price is controllable — this saves 30–50% vs viem's default estimate on Sepolia.

### RPC reliability (`wagmi.ts`)

Five endpoints configured with `rank: true` auto-benchmarking:

```typescript
fallback([
  http('https://eth-sepolia.g.alchemy.com/v2/...'),  // Primary (paid)
  http('https://eth-sepolia.drpc.org'),
  http('https://api.zan.top/eth-sepolia'),
  http('https://ethereum-sepolia-rpc.publicnode.com'),
  http('https://1rpc.io/sepolia'),
], { rank: true })  // Health-checks all, routes to fastest, re-ranks every 60s
```

### State polling strategy (`useGameState.ts`)

```typescript
// Static interval — avoids TanStack Query skipping real RPC calls on "fresh" data
refetchInterval: 2_000   // Every 2s, unconditional
staleTime: 0             // Data always considered stale → every tick sends real RPC call
```

8 on-chain reads batched into one `useReadContracts` multicall per tick. Results cached to `localStorage` as `placeholderData` — UI shows last known state instantly on reload.

**Stable phase guard:** A `useRef` stores the last known valid `gameState`. If the RPC returns `undefined` (network hiccup), the cached value is used instead of defaulting to 0 (WAITING), which would wrongly eject active players back to the lobby.

### localStorage persistence

Client-side state (`playerPos`, `visitedCells`, `moveCount`, `lastPing`, `pingHistory`) is mirrored to `localStorage` keyed as:

```
fhe-hunt:{CONTRACT_ADDRESS}:{playerAddress}
```

Cleared on `GameReset` event. Multiple wallets or contracts never conflict.

---

## Security

### Two security audits conducted

**Audit 1** (`fhenix-toolkit:fhenix-review`) — 6 issues fixed:
- `FHE.req()` replaced with `FHE.verifyDecryptResult()` pattern
- Missing `FHE.allowThis()` calls added after storing encrypted results
- `ebool.wrap(bytes32(0))` used for zero values (not `delete`, which is invalid for value types)

**Audit 2** (deep `fhe-reviewer` subagent) — 4 additional issues fixed:
- **H1 (High):** Stale treasure coordinates persisted after `resetGame()` — fixed by zeroing `euint8.wrap(bytes32(0))`
- **H2 (High):** Burner key stayed mapped to player after reset — fixed by clearing `burnerToPlayer` and `playerToBurner` in reset loop
- **M1 (Medium):** Global `pendingClaimer` lock blocked concurrent claims — redesigned to per-player `mapping(address => bool) hasPendingClaim`
- **M2 (Medium):** Wrong-coord TX2 never called left claim permanently dirty — frontend now always calls `finalizeWinClaim` regardless of decrypt result

### Storage slot constraint

`pendingClaimResult` mapping base is at **storage slot 13** (hardcoded in the frontend's `getStorageAt` call). Do NOT reorder the contract state variables — any reorder silently breaks the win claim flow.

```
Slot 0:  treasureX (euint8 = bytes32)
Slot 1:  treasureY
Slot 2:  owner (address)
Slot 3:  players mapping
...
Slot 12: winner (address) + treasureSet (bool) — packed together
Slot 13: pendingClaimResult mapping base  ← frontend hardcodes this
Slot 14: hasPendingClaim mapping base
```

---

## Local Development

### Requirements

- [Foundry](https://book.getfoundry.sh/getting-started/installation) 1.5.1+
- Node.js 18+
- MetaMask or Rabby with Sepolia ETH

### Smart contract

```bash
cd smartcontract
npm install
```

```powershell
# Windows PowerShell (use full path to avoid PATH bug)
& "$env:USERPROFILE\.foundry\bin\forge.exe" build --skip test --skip script
& "$env:USERPROFILE\.foundry\bin\forge.exe" test -vvv
```

```bash
# Linux/macOS
forge build --skip test --skip script
forge test -vvv
```

Test base class is `CofheTest` from `@cofhe/foundry-plugin`. All tests call `deployMocks()` in `setUp()` which deploys the full mock FHE stack (TaskManager, ACL, ZK Verifier) locally.

### Frontend

```bash
cd frontend
npm install --legacy-peer-deps   # Required: @cofhe/sdk peer dep conflict with wagmi v3
```

Create `frontend/.env`:
```
VITE_CONTRACT_ADDRESS=0x59C161D28aF2D8f5929FC1bEDCCC3dae12dbDA54
VITE_CHAIN_ID=11155111
VITE_SEPOLIA_RPC=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
```

```bash
npm run dev    # Start dev server at http://localhost:5173
npm run build  # Production build → dist/
```

### Environment variables

The `VITE_SEPOLIA_RPC` key is gitignored. Set it directly in Vercel dashboard under **Settings → Environment Variables**. Never commit it.

---

## Known limitations

- `checkProximity()` requires a manual TX per scan — FHE computation is not free, cannot auto-update every block.
- Win claim TX2 must be completed in the same browser session as TX1 (signature is returned by SDK, not stored on-chain). If user closes browser between TX1 and TX2, owner must call `cancelPendingClaim(address)` to unstick.
- FHE ops cost ~300–500k gas vs ~21k for a simple ETH transfer — burner wallet is strongly recommended for a good UX.
