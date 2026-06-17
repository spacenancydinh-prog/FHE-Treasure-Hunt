# FHE Treasure Hunt — Frontend

Live: **https://fhe-treasure-hunt.vercel.app/**

A blockchain treasure hunt game where all positions are encrypted using Fully Homomorphic Encryption (FHE). Players move on an encrypted grid, receive warm/cold proximity pings computed on ciphertext, and race to find a hidden treasure coordinate. No one — including the server — can see any player's position.

## Stack

- React + Vite + TypeScript
- wagmi v3 + viem v2 (wallet/chain)
- @cofhe/sdk (FHE client-side encryption)
- Deployed on Ethereum Sepolia — contract `0x59C161D28aF2D8f5929FC1bEDCCC3dae12dbDA54`

## Local development

```bash
cp .env.example .env
# Fill in VITE_SEPOLIA_RPC with an Alchemy/Infura Sepolia URL
npm install --legacy-peer-deps
npm run dev
```
