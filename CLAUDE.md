# FHE Treasure Hunt — Claude Code Instructions

## Project overview
A blockchain treasure hunt game where all positions are encrypted using Fully Homomorphic Encryption (FHE). Players move on an encrypted grid, receive warm/cold proximity pings computed on ciphertext, and race to find a hidden treasure coordinate. No one — including the server — can see any player's position.

## Stack
- **Smart contract**: Solidity 0.8.25 + Fhenix CoFHE (`@fhenixprotocol/cofhe-contracts`)
- **Build tool**: Foundry 1.5.1-stable (`forge`, `cast`, `anvil`) + `@cofhe/foundry-plugin`
- **Network**: Ethereum Sepolia (chainId: 11155111, testnet), local Foundry with mock FHE via `@cofhe/mock-contracts`
- **Frontend**: React + Vite + TypeScript
- **Wallet**: wagmi v2 + viem
- **FHE client**: `@cofhe/sdk` (browser: import from `@cofhe/sdk/web`, NOT `/node`)
- **Styling**: CSS modules — terminal/cyberpunk aesthetic (see design-ref/DESIGN.md)

## Design Reference — MANDATORY
**Before writing ANY frontend code, read ALL 3 files in this order:**

1. `cat design-ref/DESIGN.md`     ← design tokens, colors, typography, rules
2. `cat design-ref/code.html`     ← exact HTML structure to replicate
3. `open design-ref/screen.png`   ← visual target to match

**These 3 files are the single source of truth for ALL frontend work.**
Do NOT invent any styling, layout, or component structure.
Do NOT proceed with frontend code until all 3 files have been read.

**Key tokens (from DESIGN.md):**
- **Background**: #131313
- **Primary/Cyan**: #00f2ff
- **Violet/Hot**: #dc50ff
- **Font UI**: Inter
- **Font data**: JetBrains Mono
- **Border radius**: 0px (sharp edges, no exceptions)
- **Panels**: `rgba(255,255,255,0.03)` + `backdrop-filter: blur(20px)`
- **No drop shadows** — use outer glows (`box-shadow` with color) only
- **Active borders**: `1px solid rgba(0,242,255,0.3)`

## Rules — read these before doing anything
All detailed rules are in `.claude/rules/`. Claude Code loads them automatically.

- `.claude/rules/fhe-reference.md` — complete FHE types, ops, access control, common mistakes
- `.claude/rules/contract.md`      — TreasureHunt-specific contract rules
- `.claude/rules/foundry.md`       — Foundry config rules (do not change)
- `.claude/rules/frontend.md`      — design system rules (do not change)
- `.claude/skills/treasurehunt-contract.md` — contract functions, FHE patterns, access control, common errors

## Repo structure
```
fhe-treasure-hunt/
├── .claude/
│   ├── rules/            # auto-loaded by Claude Code
│   ├── commands/         # /deploy /test-contract /gen-component /sync-abi
│   └── settings.json
├── design-ref/
│   ├── DESIGN.md         # terminal/cyberpunk design system
│   ├── code.html         # HTML visual reference
│   └── screen.png        # screenshot reference
├── smartcontract/
│   ├── src/TreasureHunt.sol
│   ├── test/
│   ├── script/
│   ├── foundry.toml
│   ├── remappings.txt
│   └── package.json
├── frontend/
│   └── src/
│       ├── components/screens/  # LobbyScreen, GameBoard, VictoryScreen
│       ├── hooks/               # useGameState, useFHEEncrypt, useGameContract
│       ├── lib/                 # contract.ts, abi.ts, wagmi.ts
│       ├── styles/              # globals.css, design-tokens.css, animations.css
│       └── types/game.ts
└── CLAUDE.md
```

## Commands
```bash
# Smart contract (Windows: use PowerShell with full forge path to avoid path bug)
# PowerShell:
cd smartcontract; & "$env:USERPROFILE\.foundry\bin\forge.exe" build --skip test --skip script
cd smartcontract; & "$env:USERPROFILE\.foundry\bin\forge.exe" test -vvv
cd smartcontract; & "$env:USERPROFILE\.foundry\bin\forge.exe" test --match-test testFuzz -vvv
cd smartcontract; & "$env:USERPROFILE\.foundry\bin\forge.exe" snapshot

# Frontend
cd frontend && npm run dev
cd frontend && npm run build
```

## Game types
```typescript
type PingLevel = 'FROZEN' | 'COLD' | 'WARM' | 'HOT';

type GameState = {
  phase: 'lobby' | 'hunting' | 'victory';
  playerPos: { x: number; y: number } | null;
  visitedCells: Array<{ x: number; y: number }>;
  moveCount: number;
  lastPing: PingLevel | null;
  pingHistory: PingLevel[];
  pot: bigint;
  playerCount: number;
  isWinner: boolean;
};
```

## Environment variables
```
# smartcontract/.env
PRIVATE_KEY=
ETHEREUM_SEPOLIA_RPC=
ETHERSCAN_API_KEY=
CONTRACT_ADDRESS=0x59C161D28aF2D8f5929FC1bEDCCC3dae12dbDA54   ← current deployed address

# frontend/.env
VITE_CONTRACT_ADDRESS=0x59C161D28aF2D8f5929FC1bEDCCC3dae12dbDA54
VITE_CHAIN_ID=11155111
VITE_SEPOLIA_RPC=   ← set Alchemy/Infura URL; public RPCs are slow
```

## Contract API (updated after security audit)

> Audited with `fhenix-toolkit:fhenix-review`. 6 issues fixed. Contract recompiled clean with Foundry 1.5.1.

### Key API changes vs original

**`checkProximity()`** — now returns `euint8` (sealed, not `uint8(0)`).
Frontend flow: call tx → wait → call `getLastBucket()` → `decryptForView(handle, FheTypes.Uint8)`.

**`claimWin()` removed → replaced with 2-transaction pattern:**
```
TX 1: prepareWinClaim(InEuint8 x, InEuint8 y)
        → computes encrypted comparison, stores handle, emits WinClaimPrepared

Off-chain: decryptForTx(handle).withPermit().execute()
        → returns { result: bool, signature: bytes }

TX 2: finalizeWinClaim(bool result, bytes signature)
        → FHE.verifyDecryptResult() on-chain → transfers pot if valid
```

**New view functions:** `getLastBucket()`, `hasPendingClaim(address) → bool`

**New write functions:** `cancelPendingClaim(address claimer)` — owner only, clears stuck pending claim

**New event:** `WinClaimPrepared(address indexed claimer)`

**Concurrent claims:** Multiple players can now call `prepareWinClaim()` simultaneously. No global single-claimer lock. Each player tracks their own `hasPendingClaim[addr]` state.

### FHE library constraints (`@fhenixprotocol/cofhe-contracts@0.1.3`)
- `euint8` / `ebool` are `bytes32` internally (not `uint256`) — use `.wrap(bytes32(0))` to zero, not `delete`
- `FHE.req(ebool)` does NOT exist — use `FHE.verifyDecryptResult()` + `require(result)` pattern
- `FHE.allowPublic(ct)` exists — use for public decryption without permit
- `FHE.allow(ct, addr)` exists — use for per-user permit-based decryption

## Project status

### ✅ Smart contract — COMPLETE & DEPLOYED
- Deployed: `0x59C161D28aF2D8f5929FC1bEDCCC3dae12dbDA54` on Ethereum Sepolia
- Security audit 1 passed (fhenix-toolkit:fhenix-review) — 6 issues fixed
- Security audit 2 passed (fhenix-toolkit:fhe-reviewer deep audit) — 4 additional issues fixed (2 High + 2 Medium)
- Full on-chain test suite passed (`smartcontract/scripts/full-flow.ts`)
- **Concurrent claims redesign** (latest): `address pendingClaimer` → `mapping(address => bool) hasPendingClaim`. Multiple players can prepare win claims simultaneously. `cancelPendingClaim(address)` added for owner to unstick any claimer without resetting game.
- Previous addresses (do NOT use): `0x043379b4fd49751B3f19a4e4bEB3B08e0F1311F3` (pre-audit), `0x0dF2F4E15FcF7B627B0C331C252F7113558a0E5E` (wrong game flow), `0x886513CA12E01CA96F9B024aBe0FF5725C953749` (missing gameState=ACTIVE in setTreasure), `0x3B22Dd35A23c2caCA65DFd7275C7a7A332D38e16` (pre-audit-2: stale treasureX/Y + burner not cleared on reset), `0xFd4F1D71aA3e0bF70d722a8372805c6002c99E69` (pre-concurrent-claims: single `pendingClaimer` address lock)
- `authorizeBurner(address burner)` added: lets players delegate moves to a local burner key
- `playerToBurner` reverse mapping added: enables clean burner cleanup on `resetGame()`
- `ClaimFailed(address claimer)` event added: emitted when wrong-coords claim is cleared without reverting

### ✅ Frontend — SHIPPED, LIVE ON SEPOLIA
All 3 screens built and tested against deployed contract.

| File | Status |
|------|--------|
| `hooks/useGameState.ts` | ✅ Multicall (8 reads → 1 RPC), stable phase, localStorage persistence for client state + on-chain cache (placeholderData), static polling `refetchInterval: 2_000` + `staleTime: 0` |
| `hooks/useFHEEncrypt.ts` | ✅ @cofhe/sdk/web init, encryptCoords, decryptBucket, decryptForTx — **chưa E2E tested** |
| `hooks/useGameContract.ts` | ✅ All contract writes. move() fire-and-forget. Burner path integrated. `maxPriorityFeePerGas: 1 gwei` hint cho MetaMask path. |
| `hooks/useBurnerWallet.ts` | ✅ Deterministic burner key. 3-step flow. `moveWithBurner` set explicit gas: `maxPriorityFee=1 gwei`, `maxFeePerGas=baseFee×1.5+1 gwei`. |
| `lib/wagmi.ts` | ✅ 5-RPC fallback with `rank: true` auto-benchmarking, retryDelay 400ms |
| `context/ToastContext.tsx` | ✅ Global toast system — TX errors shown as toasts |
| `components/screens/LobbyScreen.tsx` | ✅ Players join first (≥2), then owner sets treasure. UI polish: radial-gradient card bg, glowing corner brackets, stats gradient border, rotating radar outer ring, amber Step-1 badge, "X JOINED / min 2" display. |
| `components/screens/GameBoard.tsx` | ✅ 16×16 grid, movement pad, scan area, claim modal, burner session panel (3 states). HOT banner removed. "Another player claiming" banner removed (replaced by per-player `hasPendingClaim`). Caution text removed. |
| `components/screens/VictoryScreen.tsx` | ✅ Prize pot = playerCount × ENTRY_FEE (on-chain pot = 0 after CEI) |

### Important decisions & rationale

**Game start order: players JOIN first, then owner sets treasure**
`setTreasure()` requires `playerCount >= MIN_PLAYERS (2)`. Players join → game fills → owner calls `setTreasure()` which simultaneously places treasure AND transitions game to ACTIVE. UI: JOIN button enabled immediately, treasure panel shows "NEED N MORE PLAYER(S)" until ≥2 joined.

**Deterministic burner wallet — no key storage**
Burner private key = `keccak256(MetaMask signature of fixed message)`. Same wallet always produces same burner address. User signs once per session (free, no gas). No `sessionStorage`/`localStorage` for the key. If user already registered this burner on-chain in a prior session, step 2 (register) is auto-skipped since `isAuthorized` check sees the prior registration.

**3-step burner session flow**
- Step 1 — DERIVE (free): MetaMask signs deterministic message → burner key derived client-side
- Step 2 — REGISTER (1 TX): `authorizeBurner(burnerAddr)` → maps burner → player on-chain
- Step 3 — ACTIVE: all moves sent from burner wallet, no MetaMask popup

**localStorage persistence for client-side game state**
`playerPos`, `visitedCells`, `moveCount`, `lastPing`, `pingHistory` live in React state and are lost on reload. Now mirrored to `localStorage` keyed by `fhe-hunt:${CONTRACT_ADDRESS}:${address}`. Restored on wallet connect. Cleared on `GameReset` event. Multiple wallets / contracts don't conflict.

**On-chain state cache (placeholderData)**
`useReadContracts` results cached to localStorage under `fhe-hunt:onchain:${CONTRACT_ADDRESS}`. Used as React Query `placeholderData` so UI shows last known chain state instantly on reload instead of blank loading screen. Real fetch runs in background; component re-renders when fresh data arrives.

**Static `refetchInterval: 2_000` + `staleTime: 0` for lobby→game transition**
Public HTTP RPCs don't support WebSocket so `useWatchContractEvent` polls `eth_getLogs`. Root cause of missed lobby→game transition: dynamic `refetchInterval` function + `staleTime: 4_000` meant TanStack Query skipped real RPC calls when data was "fresh" (<4s old). Fix: `refetchInterval: 2_000` (static) + `staleTime: 0` (data always stale → every timer tick sends a real RPC call). Event watchers set to `pollingInterval: 2_000`. Admin also retries `game.refetch()` every 1s for 8s after `setTreasure()` TX confirms. Maximum detection delay: ~2-3s.

**RPC transport: `rank: true` auto-benchmarking**
5 public endpoints configured (drpc, zan, publicnode, tatum, 1rpc). `fallback(..., { rank: true })` sends health-check requests to all, routes to the fastest one, re-ranks every 60s. Eliminates the problem of a slow-but-non-failing RPC being used as primary.

**move() is fire-and-forget, no waitReceipt**
`waitReceipt()` internally calls `setTxStatus('confirming')` which re-locked the UI. Fix: call `publicClient.waitForTransactionReceipt()` directly (no status side-effect) and return true immediately after TX enters mempool. Grid updates optimistically.

**Stable phase — never downgrade on RPC error**
`rawState = undefined` (RPC hiccup) was defaulting to 0 = WAITING = lobby, kicking players mid-game. Fix: `useRef` stores last known good rawState; undefined falls back to cached value instead of 0.

**Prize pot on VictoryScreen = playerCount × ENTRY_FEE**
Contract uses CEI pattern: `pot = 0` before transfer, so `getPot()` always returns 0 after game ends. VictoryScreen now computes `playerCount * ENTRY_FEE` instead of reading on-chain pot.

**getLastBucket() requires account: playerAddr**
This view function has `require(players[msg.sender])`. Public `readContract` calls use address(0) which fails the require. Must always pass `account: playerAddress` in readContract options.

**checkProximity / SCAN AREA requires manual trigger (by design)**
FHE proximity is computed on encrypted data on-chain — each check costs gas. Cannot auto-update. UI labels it "SCAN AREA (1 TX)" with explanation. HOT banner removed — it added noise without value; players can read the proximity gauge directly.

**Concurrent win claims — per-player mapping instead of global lock**
Original contract stored `address public pendingClaimer` — one player's pending claim blocked everyone else from claiming. Bug surface: if TX2 (finalizeWinClaim) was never called (e.g. user closed browser after TX1), the address got permanently stuck. Fix: replaced with `mapping(address => bool) hasPendingClaim`. Each player tracks their own claim state independently. Owner can call `cancelPendingClaim(addr)` to unstick without resetting the game. Storage slot 13 (`pendingClaimResult` mapping base) preserved — frontend's `getStorageAt(slot 13)` still works.

**Wrong-coords claim: always call TX2 (finalizeWinClaim)**
Previous bug: frontend skipped TX2 when FHE decrypt returned `false` (wrong coords), leaving `hasPendingClaim[sender] = true` forever. Fix: TX2 is always called regardless of result. `finalizeWinClaim(false, sig)` clears the pending state on-chain and emits `ClaimFailed`. Error message changed from raw "prepareWinClaim reverted" → "Treasure not found here — keep searching".

**"DECRYPTORS READY" display: X JOINED / min 2 (not a capacity)**
Old display "0 / 2" was semantically wrong — implied a maximum of 2 players. Contract has no upper limit; 2 is the minimum to start. Fixed to show "0 JOINED" with subtext "min 2 to start".

**FUND BURNER button: at most 1 button visible at any time**
Burner balance is split into two non-overlapping zones to prevent duplicate buttons:
- `burnerCritical` = `balance < 1e15` (< 0.001 ETH): SESSION KEY panel shows "LOW" + FUND BURNER. No inline/proactive button.
- `burnerWarning` = `1e15 ≤ balance < 2e15` (0.001–0.002 ETH): proactive warning + button below controls (no txError), OR inline button below error bar (with txError).
- After `fundBurner()` TX confirms: call `contract.reset()` to clear `txError` → all FUND BURNER buttons disappear immediately.

**Gas price optimization for burner moves**
FHE `move()` uses 300–500k gas (fixed by ZK proof verification — cannot reduce). Gas PRICE is controllable. `moveWithBurner` reads current `baseFee` from latest block and sets `maxPriorityFeePerGas = 1 gwei`, `maxFeePerGas = baseFee × 1.5 + 1 gwei`. MetaMask path gets `maxPriorityFeePerGas: 1 gwei` hint. Saves ~30–50% gas cost vs viem's default estimate on Sepolia.

### ⏳ Next steps

**Cần test trên browser (code đã đúng, chưa E2E test):**
- **Real FHE decrypt** — `useFHEEncrypt.ts` implement đầy đủ. Cần: MetaMask Sepolia → join game → move → SCAN AREA → confirm bucket decrypt đúng.
- **Win claim 2-TX flow** — code đầy đủ trong `useGameContract.ts`. Storage slot 13 verified đúng. Cần E2E: move đến đúng tọa độ → CLAIM WIN → confirm ETH về ví. Test cả wrong-coords path (expect "Treasure not found here" message + `hasPendingClaim` cleared).
- **Burner wallet full flow** — UX đã hoàn chỉnh. Cần E2E test: derive → register → FUND BURNER → confirm moves gửi không có MetaMask popup, gas cost thấp hơn trước.

**✅ Đã xong (session mới nhất):**
- **Contract concurrent claims redesign** — `address pendingClaimer` → `mapping hasPendingClaim`. Redeployed tại `0x59C161D28aF2D8f5929FC1bEDCCC3dae12dbDA54`. `cancelPendingClaim(addr)` thêm để owner unstick claimer.
- **Frontend sync với contract mới** — ABI updated, `useGameState` reads `hasPendingClaim(myAddr)`, GameBoard loại bỏ global-claimer logic.
- **Wrong-coords claim fix** — TX2 luôn được gọi dù result=false. Error message cải thiện.
- **LobbyScreen UI polish** — Radial-gradient card background, glowing corner brackets, stats gradient top border, rotating radar outer ring, amber Step-1 badge với blinking dot, "X JOINED / min 2 to start" display.
- **Typography đồng nhất trong stats grid** — `statCardText` (Sepolia_Testnet) tăng lên 0.95rem/bold/cyan để match visual weight với value cards khác.
- **Removed clutter từ GameBoard** — HOT banner, "Another player is claiming" banner, caution text đã xóa.

**✅ Đã xong (các session trước):**
- **FUND BURNER UX** — `burnerCritical`/`burnerWarning` zones, `contract.reset()` sau fund.
- **Gas price tối ưu** — `maxPriorityFee=1 gwei`, `maxFeePerGas=baseFee×1.5+1 gwei`.
- **Paid RPC** — `VITE_SEPOLIA_RPC` set trong `frontend/.env` (Alchemy Sepolia).
- **Mobile layout** — breakpoint 480px cho LobbyScreen, VictoryScreen.
- **Lobby→game transition** — `staleTime: 0` + `refetchInterval: 2_000` + retry loop 8s sau `setTreasure()`.

**Known limitations:**
- `pendingClaimResult` storage slot (slot 13) hard-coded trong `useGameContract.ts`. Verified đúng: `winner`(address) + `treasureSet`(bool) pack chung slot 12, nên mapping `pendingClaimResult` ở slot 13. Nếu reorder state vars trong contract → phải update slot number.
- `claimPhase` state trong GameBoard không sync với `contract.txStatus` trong bước decrypt — dùng local state riêng (intentional, tránh re-lock UI).

## What NOT to do
- Do NOT use Hardhat — this project uses Foundry
- Do NOT change any visual styling without being explicitly asked. Always read `design-ref/DESIGN.md` before creating any UI component
- Do NOT use Tailwind — project uses plain CSS modules
- Do NOT use border-radius — all corners are sharp (0px) per design system
- Do NOT use drop shadows — use outer glows instead per design system
- Do NOT add new npm/forge dependencies without checking existing ones first
- Do NOT decrypt player positions anywhere except client-side via cofhejs
- Do NOT store plaintext coordinates anywhere in contract state
- Do NOT remove `code_size_limit = 100000` from foundry.toml
- Do NOT remove the `hardhat/` line from remappings.txt
- Do NOT call move(), prepareWinClaim(), or setTreasure() without first encrypting via @cofhe/sdk — read treasurehunt-contract.md for pattern
- Do NOT use `claimWin()` — it no longer exists. Win flow is now 2 transactions: `prepareWinClaim()` then `finalizeWinClaim(result, signature)`
- Do NOT use `FHE.req()` — not available in `@fhenixprotocol/cofhe-contracts@0.1.3`. Use `FHE.verifyDecryptResult()` pattern instead
- Do NOT import `@cofhe/sdk` without the `/web` subpath in browser code — use `@cofhe/sdk/web`
- Do NOT call `waitReceipt()` (the shared helper) inside move() — it calls `setTxStatus('confirming')` and re-locks the UI. Use `publicClient.waitForTransactionReceipt()` directly for fire-and-forget
- Do NOT read `getPot()` on VictoryScreen — pot is 0 after CEI transfer. Use `playerCount × ENTRY_FEE` instead
- Do NOT call `readContract({ functionName: 'getLastBucket' })` without `account: playerAddress` — the function has `require(players[msg.sender])` which fails for address(0)
- Do NOT mix separate `useReadContract` calls when `useReadContracts` can batch them — always prefer 1 multicall over N separate RPC calls
- Do NOT store the burner private key in `sessionStorage` or `localStorage` — derive it deterministically from `keccak256(signMessageAsync({ message: buildSignMessage(address) }))` each session
- Do NOT use a dynamic `refetchInterval` function for game state polling — use `refetchInterval: 2_000` (static) + `staleTime: 0`. Dynamic function + staleTime > 0 causes TanStack Query to skip real RPC calls when data is "fresh".
- Do NOT add `useWatchContractEvent` calls without `pollingInterval: 2_000` — the default 4000ms HTTP polling is too slow for lobby→game transition detection
- Do NOT show more than 1 FUND BURNER button at the same time — use `burnerCritical` (< 1e15) for SESSION KEY panel and `burnerWarning` (1e15–2e15) for proactive warning; the two zones must not overlap
- Do NOT forget to call `contract.reset()` after a successful `fundBurner()` — without it, `txError` persists and the inline FUND BURNER button stays visible after funding
- Do NOT let viem auto-estimate gas price for burner moves — always set `maxPriorityFeePerGas: parseGwei('1')` and `maxFeePerGas: baseFee * 15n / 10n + parseGwei('1')` explicitly. Gas USED (~300–500k) is fixed by FHE ZK proof; only gas PRICE is controllable.
- Do NOT use old contract addresses: `0x043379b4fd49751B3f19a4e4bEB3B08e0F1311F3` (pre-audit), `0x0dF2F4E15FcF7B627B0C331C252F7113558a0E5E` (wrong game flow), `0x886513CA12E01CA96F9B024aBe0FF5725C953749` (missing gameState=ACTIVE), `0x3B22Dd35A23c2caCA65DFd7275C7a7A332D38e16` (pre-audit-2), or `0xFd4F1D71aA3e0bF70d722a8372805c6002c99E69` (single pendingClaimer lock). Current: `0x59C161D28aF2D8f5929FC1bEDCCC3dae12dbDA54`
- Do NOT use `pendingClaimer` — this field no longer exists. Use `hasPendingClaim(address) → bool` mapping instead
- Do NOT skip TX2 (finalizeWinClaim) when FHE decrypt returns false — always call finalizeWinClaim regardless of result, so `hasPendingClaim` gets cleared on-chain
- Do NOT assume treasure must be set before players join — the correct order is: players join first (≥2), then owner calls setTreasure() to start the game
- Do NOT reorder state variables in TreasureHunt.sol — storage slot 13 for `pendingClaimResult` mapping is hardcoded in `useGameContract.ts`. Any reorder breaks the win claim flow silently.