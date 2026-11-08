# Pi domain validation keys

Pi issues a DIFFERENT validation key per app/network context, but Pi only ever
checks ONE file: /validation-key.txt

So this file can only satisfy one network at a time. Swap the contents of
`validation-key.txt` depending on which network you need verified.

## Testnet  (restore this if you need the live testnet app's domain re-verified)
472e6992ef3cb2388856313e6758acc3ba81f75929cb0baa5dfd30866fad51593dadda15f0b280c9c6753a96504ff6d6716aa96318fa521d98f854bb80d07d4b

## Mainnet  (CURRENTLY ACTIVE — switched 2026-07-15 for the mainnet wallet application)
a3a5080582f714bc658fc3b2fdd9a68971c90a81622a88206f9926ce88378d6ab557e5003eb3438d4267bcfb307ce579d7943656dac070607e46c6594fa2e440

## IMPORTANT
Writing the mainnet key here BREAKS testnet domain verification (and vice versa).
That is what happened on 2026-06-23: the file was switched to the mainnet key,
which silently invalidated the testnet app's domain ownership. It just happened
again on purpose on 2026-07-15 to unblock the mainnet wallet application — the
live testnet app's domain is unverified with Pi until this gets swapped back.

To restore testnet: copy the Testnet key above into validation-key.txt, commit,
push, and confirm on Pi's Developer Portal that testnet domain verification
passes again before assuming it's fixed.

The real fix is Pi's own recommendation: keep SEPARATE apps (and separate
domains) for testnet and mainnet, so each can hold its own validation key.
