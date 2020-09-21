## Ethereum - Battlefield

A repository containing contracts and scripts to effectively testing
all aspects of our Ethereum instrumentation.

This repository assumes you have the following tool in available
globally through your terminal:

- geth (Deep mind enabled)
- yarn (1.13+)
- curl
- jq

### Running

Running the whole battlefield test set is simply a matter of
first installing script dependencies (mainly web3 to interact
with the chain):

    yarn install

Then, you run the `generate_local.sh` script which will compile the
smart contracts, launch a miner and syncer Geth processes,
execute a bunch of transactions and collect the logs of
all this and more specially, the deep mind logs for future
analysis:

    ./bin/generate_local.sh

### Explanation

To correctly work, the process is as follow. First, all
smart contracts are compiled through an invocation of
`./contract/build.sh` script which spans a Docker
container to compile all contracts using `solc` compiler.

Then, the rough idea is to have a miner process that will
receive all transactions through RPC calls (via Web3 TypeScript
scripts found in this repository).

The miner process generate blocks for incoming transactions
and not always using a Proof of Authority network.

**FIXME** This is probably not fully simulating the Ethereum
Mainnet as there is no mining reward in this mode, we should
probably do something a bit different?

The syncer is then connected with the miner process via native
Ethereum P2P protocol. The miner `enode` id is set to a fixed
value (via the `boot/nodekey` file that is copied into the
miner data directory). The syncer has a `static-nodes.json`
file that tells it how to talk to the miner process.

The syncer then simply sync from the miner each time new
blocks are propagated through the network. The syncer is
deep mind aware and generates the deep mind log.

#### Private Keys

The current boot addresses and their respective private key are:

- Address `ea143138dab9a14e11d1ae91e669851e6cc72131` => Private Key `4941116954b6ced5ead503a2fa8c04a0d8fed6377278437f06f6915760fd3af9`
- Address `d549d2fd4b177767b84ab2fd17423cee1cf1d7bd` => Private Key `1386e4d24a11a739e3afee0b57cb23c0685114ac2a4e648298d317ab386804e8`
- Address `545594058eb1dcb59add9ca2a0b13657122147ea` => Private Key `5f80b870cb5aeda4b4b10a5aadd27d0f9d53eddd47fe54520c47d55adbae6b04`
