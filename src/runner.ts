import { join as pathJoin } from "path"
import Web3 from "web3"
import { PromiEvent, TransactionReceipt, TransactionConfig } from "web3-core"
import BN from "bn.js"
import {
  readContract,
  promisifyOnFirstConfirmation,
  requireProcessEnv,
  initialDefaultAddress,
  sendRawTx,
  createRawTx,
  setDefaultTxOptions,
  getDefaultGasConfig,
  isUnsetDefaultGasConfig,
} from "./common"
import { ContractSendMethod, Contract } from "web3-eth-contract"
import { deployContract, deployContractRaw, DeploymentResult, DeployerOptions } from "./deploy"
import { readFileSync, writeFileSync, existsSync } from "fs"
import Common from "ethereumjs-common"

export type Network = "local" | "dev1" | "ropsten"

type Doer<T> = (() => T) | (() => Promise<T>)

const Contracts = {
  main: { name: "main", source: "Main" },
  child: { name: "child", source: "Child" },
  grandChild: { name: "grandChild", source: "Grandchild" },
  suicidal1: { name: "suicidal1", source: "Suicidal" },
  suicidal2: { name: "suicidal2", source: "Suicidal" },
  uniswap: { name: "uniswap", source: "UniswapV2Factory" },
  erc20: { name: "erc20", source: "EIP20Factory" },
}

const contractIds = Object.keys(Contracts) as ContractID[]

type ContractID = keyof typeof Contracts
type DeploymentState = Record<ContractID, DeploymentResult>
type DeploymentContracts = Record<ContractID, Contract>

const emptyDeploymentState = () => {
  const state = {} as DeploymentState
  contractIds.forEach((contractId: ContractID) => {
    state[contractId] = { contractAddress: "", transactionHash: "" }
  })

  return state
}

const emptyDeploymentContracts = () => {
  const state = {} as DeploymentContracts
  contractIds.forEach((contractId: ContractID) => {
    state[contractId] = null as any
  })

  return state
}

interface ResolvedSendOptions {
  from: string
  to: string
  gasPrice: string
  gas: number
  value: number | string | BN
  data?: string
}

export class BattlefieldRunner {
  // Going to be fully initialize in the `initialize` call
  defaultAddress: string = ""
  deploymentState: DeploymentState = emptyDeploymentState()
  contracts: DeploymentContracts = emptyDeploymentContracts()

  deployer: (name: string, options?: DeployerOptions) => Promise<DeploymentResult>

  deploymentStateFile: string
  network: Network
  privateKey?: Buffer
  rpcEndpoint: string
  web3: Web3

  only?: RegExp

  constructor(network: Network) {
    this.network = network
    this.deploymentStateFile = ""
    this.deployer = this.deployRpcContract

    this.rpcEndpoint = process.env["RPC_ENDPOINT"] || ""

    if (!this.rpcEndpoint) {
      this.rpcEndpoint = this.forNetwork({
        local: "http://localhost:8545",
        dev1: "http://localhost:8545",
        ropsten: "https://ropsten.infura.io/json-rpc/",
      })
    }

    const setupExternalNetwork = () => {
      this.deployer = this.deployRawContract

      this.deploymentStateFile = pathJoin(
        __dirname,
        `../state/${this.network}-deployment-state.json`
      )
      this.defaultAddress = requireProcessEnv("FROM_ADDRESS")
      this.privateKey = Buffer.from(requireProcessEnv("PRIVATE_KEY"), "hex")

      if (this.privateKey.length != 32) {
        console.error(`private key '${this.privateKey.toString("hex")}' should have 64 characters`)
        process.exit(1)
      }
    }

    this.doForNetwork({
      local: () => {
        this.deployer = this.deployRpcContract
      },
      dev1: setupExternalNetwork,
      ropsten: setupExternalNetwork,
    })

    this.web3 = new Web3(this.rpcEndpoint)
  }

  async initialize() {
    await this.doForNetwork({
      local: async () => {
        this.defaultAddress = await initialDefaultAddress(
          this.web3.eth,
          process.env["FROM_ADDRESS"]
        )
      },
      dev1: async () => {
        setDefaultTxOptions({
          common: Common.forCustomChain(
            "mainnet",
            {
              name: "dev1",
              networkId: 1,
              chainId: 123,
            },
            "byzantium"
          ),
        })
      },
      ropsten: async () => {
        setDefaultTxOptions({ chain: "ropsten", hardfork: "istanbul" })
      },
    })

    this.deploymentState = await this.loadDeploymentState()
  }

  async loadDeploymentState(): Promise<DeploymentState> {
    return await this.doForNetwork({
      local: async () => this.deploymentState,
      dev1: this.loadDeploymentStateFromFile,
      ropsten: this.loadDeploymentStateFromFile,
    })
  }

  loadDeploymentStateFromFile = async (): Promise<DeploymentState> => {
    if (existsSync(this.deploymentStateFile)) {
      const content = readFileSync(this.deploymentStateFile)
      const actualState = JSON.parse(content.toString())

      return { ...this.deploymentState, ...actualState }
    }

    return this.deploymentState
  }

  async deployContract(
    contract: keyof DeploymentState,
    source: string,
    options?: DeployerOptions
  ): Promise<DeploymentResult> {
    if (isDeployed(contract, this.deploymentState)) {
      console.log(`Contract ${contract} already deployed for network ${this.network}`)
      return this.deploymentState[contract]
    }

    return await this.deployer(source, options)
  }

  async deployContracts(): Promise<DeploymentState> {
    // FIXME: Only local do it in parallel for now as foreign network needs to have an update nonce after each transaction!
    // FIXME: At least, we should get rid of the enormous duplication in there...
    if (this.network === "local") {
      const promises: Record<ContractID, Promise<DeploymentResult>> = {
        main: this.deployContract("main", Contracts["main"].source),
        child: this.deployContract("child", Contracts["child"].source),
        grandChild: this.deployContract("grandChild", Contracts["grandChild"].source, {
          contractArguments: ["0x0000000000000000000000000000000000000330", false],
          value: "25000",
        }),
        suicidal1: this.deployContract("suicidal1", Contracts["suicidal1"].source),
        suicidal2: this.deployContract("suicidal2", Contracts["suicidal2"].source),

        uniswap: this.deployContract("uniswap", Contracts["uniswap"].source, {
          contractArguments: [this.defaultAddress],
        }),
        erc20: this.deployContract("erc20", Contracts["erc20"].source),
      }

      Promise.all(Object.values(promises))

      // TODO: Avoid the duplicate here, but the Promises.all is only an array it's not easy
      // to create necessary code to make it "work".
      //
      // This is all very quick since each promise is already resolved
      this.deploymentState = {
        main: await promises["main"],
        child: await promises["child"],
        grandChild: await promises["grandChild"],
        suicidal1: await promises["suicidal1"],
        suicidal2: await promises["suicidal2"],
        uniswap: await promises["uniswap"],
        erc20: await promises["erc20"],
      }
    } else {
      this.deploymentState = {
        main: await this.deployContract("main", Contracts["main"].source),
        child: await this.deployContract("child", Contracts["child"].source),
        grandChild: await this.deployContract("grandChild", Contracts["grandChild"].source, {
          contractArguments: ["0x0000000000000000000000000000000000000330", false],
          value: "25000",
        }),
        suicidal1: await this.deployContract("suicidal1", Contracts["suicidal1"].source),
        suicidal2: await this.deployContract("suicidal2", Contracts["suicidal2"].source),

        uniswap: await this.deployContract("uniswap", Contracts["uniswap"].source, {
          contractArguments: [this.defaultAddress],
        }),
        erc20: await this.deployContract("erc20", Contracts["erc20"].source),
      }
    }

    if (isAnyDeployed(this.deploymentState) && this.network != "local") {
      console.log(
        `(Delete or edit file '${this.deploymentStateFile}' to force a re-deploy to new addresses)`
      )
    }

    if (this.network != "local") {
      writeFileSync(this.deploymentStateFile, JSON.stringify(this.deploymentState, null, "  "))
    }

    await this.initializeContracts()

    return this.deploymentState
  }

  async initializeContracts() {
    const promises = contractIds.map(async (contractId: ContractID) => {
      this.contracts[contractId] = await this.getContract(
        Contracts[contractId].source,
        this.deploymentState[contractId].contractAddress
      )
      return
    })

    await Promise.all(promises)
  }

  async parallelize<T = any>(...promiseFactories: Array<() => Promise<T>>): Promise<void> {
    if (this.network == "local") {
      return Promise.all(promiseFactories.map((promiseFactory) => promiseFactory())).then(() => {
        return
      })
    }

    // Sequential for now because on non-local network, we need to actually fetch the current nonce and each parallel execution need to get the nonce for which it will work
    var result = Promise.resolve<T>(undefined as any)
    promiseFactories.forEach((promiseFactory) => {
      result = result.then(() => promiseFactory() as Promise<T>)
    })

    return result.then(() => {
      return
    })
  }

  async okTransfer(
    tag: string,
    from: string | "default",
    to: string,
    value: string | number | BN,
    options?: TransactionConfig
  ) {
    options = { ...options, from, value, to }

    return this.okSend(tag, options, async (resolvedOptions) => {
      if (this.network == "local") {
        return { promiEvent: this.web3.eth.sendTransaction(resolvedOptions) }
      }

      const tx = await createRawTx(
        this.web3,
        resolvedOptions.from,
        this.privateKey!,
        resolvedOptions
      )

      return { txHash: tx.hash(), promiEvent: sendRawTx(this.web3, tx) }
    })
  }

  async okContractSend(
    tag: string,
    contract: keyof DeploymentState,
    trx: ContractSendMethod,
    options?: TransactionConfig
  ) {
    return this.okSend(tag, options, async (resolvedOptions) => {
      if (this.network == "local") {
        return { promiEvent: (trx.send(resolvedOptions) as any) as PromiEvent<TransactionReceipt> }
      }

      const tx = await createRawTx(this.web3, resolvedOptions.from, this.privateKey!, {
        ...resolvedOptions,
        to: this.contracts[contract].options.address,
        data: trx.encodeABI(),
      })

      return { txHash: tx.hash(), promiEvent: sendRawTx(this.web3, tx) }
    })
  }

  async okSend(
    tag: string,
    options: TransactionConfig | undefined,
    eventFactory: (
      options: ResolvedSendOptions
    ) => Promise<{
      txHash?: Buffer
      promiEvent: PromiEvent<TransactionReceipt>
    }>
  ) {
    if (this.only && !tag.match(this.only)) {
      return ""
    }

    const resolvedOptions = this.mergeSendOptionsWithDefaults(options)

    let trxHashString: string = ""
    try {
      const { txHash, promiEvent } = await eventFactory(resolvedOptions)
      if (txHash && (process.env["DEBUG"] === "true" || process.env["DEBUG"] === "*")) {
        trxHashString = this.trxHashAsString(txHash.toString("hex"))
        console.log(`Pending transaction hash '${trxHashString}' (${tag})`)
      }

      const receipt = await promisifyOnFirstConfirmation(promiEvent)
      trxHashString = this.trxHashAsString(receipt.transactionHash)

      // See https://ethereum.stackexchange.com/a/6003
      //
      // The lowest value of gas for a pure transfer is 21000. Since we do some of them,
      // let's not count equal gas for this value as an error, while it could still be
      // an error, Gosh!
      if (receipt.gasUsed == resolvedOptions.gas && resolvedOptions.gas != 21000) {
        console.log(`Transaction '${trxHashString}' failed (${tag})`)
        throw new Error(`Unexpected transaction ${trxHashString} failure (${tag})`)
      }

      console.log(`Pushed transaction '${trxHashString}' (${tag})`)
      return receipt.transactionHash
    } catch (error) {
      console.log(`Transaction '${trxHashString}' (${tag}) failed`, error)
      throw new Error(`Unexpected transaction failure`)
    }
  }

  trxHashAsString(hash: string) {
    if (this.network == "local") {
      return hash
    }

    return this.ethqTxLink(hash)
  }

  mergeSendOptionsWithDefaults(options?: TransactionConfig): ResolvedSendOptions {
    const defaults: TransactionConfig = {
      from: this.defaultAddress,
    }

    if (!isUnsetDefaultGasConfig()) {
      defaults.gas = getDefaultGasConfig().gasLimit
      defaults.gasPrice = getDefaultGasConfig().gasPrice
    }

    const resolved = { ...defaults, ...(options || {}) }
    if (resolved.from === "default") {
      resolved.from = this.defaultAddress
    }

    return resolved as ResolvedSendOptions
  }

  printConfiguration() {
    console.log("Configuration")
    console.log(` Network: ${this.network}`)
    console.log(
      ` Default address: ${
        this.network === "ropsten"
          ? this.etherscanLink("/address/" + this.defaultAddress)
          : this.defaultAddress
      }`
    )
    console.log(` RPC Endpoint: ${this.rpcEndpoint}`)

    if (this.privateKey) {
      console.log(` Private key: ${this.privateKey.toString("hex").slice(0, 32) + "..."}`)
    }

    console.log()
  }

  printContracts() {
    console.log()
    console.log("Contracts")
    Object.entries(this.deploymentState).forEach((entry) => {
      console.log(`- ${entry[0]} => ${entry[1].contractAddress}`)
    })

    if (this.network != "local") {
      console.log("")
      console.log("Transaction Links")
      Object.entries(this.deploymentState).forEach((entry) => {
        console.log(`- ${entry[0]} => ${this.ethqTxLink(entry[1].transactionHash)}`)
      })
    }
  }

  ethqLink(path: string): string {
    let baseUrl = ""
    if (this.network === "dev1") {
      baseUrl = "https://dev1-eth.ethq.dfuse.dev"
    }

    if (this.network === "ropsten") {
      baseUrl = "https://ropsten.ethq.app"
    }

    return `${baseUrl}${path}`
  }

  ethqTxLink(hash: string): string {
    return this.ethqLink(`/tx/${hash}`)
  }

  etherscanLink(path: string): string {
    let baseUrl = ""
    if (this.network === "ropsten") {
      baseUrl = "https://ropsten.etherscan.io"
    }

    return `${baseUrl}${path}`
  }

  async getContract(contractName: string, address: string) {
    const abiPath = pathJoin(__dirname, `../contract/build/${contractName}.abi`)

    const contract = await readContract(this.web3.eth, abiPath)
    contract.options.address = address

    return contract
  }

  forNetwork<T>(mappings: Record<Network, T>): T {
    const result = mappings[this.network]
    if (result == null) {
      console.error(
        `invalid network configuration ${this.network} using ${JSON.stringify(mappings)}`
      )
      process.exit(1)
    }

    return result
  }

  async doForNetwork<T>(mappings: Record<Network, Doer<T> | undefined>): Promise<T> {
    const result = mappings[this.network]
    if (result == null) {
      console.error(
        `invalid network configuration ${this.network} using ${JSON.stringify(mappings)}`
      )
      process.exit(1)
    }

    return result!()
  }

  deployRpcContract = async (
    name: string,
    options?: DeployerOptions
  ): Promise<DeploymentResult> => {
    return await deployContract(this.web3, this.defaultAddress, name, options)
  }

  deployRawContract = async (
    name: string,
    options?: DeployerOptions
  ): Promise<DeploymentResult> => {
    return await deployContractRaw(this.web3, this.defaultAddress, this.privateKey!, name, options)
  }

  doNothing: any = () => {}
}

function isDeployed(contract: ContractID, deploymentState: DeploymentState): boolean {
  return deploymentState[contract].contractAddress !== ""
}

function isAnyDeployed(deploymentState: DeploymentState): boolean {
  return (
    deploymentState.main.contractAddress !== "" ||
    deploymentState.child.contractAddress !== "" ||
    deploymentState.grandChild.contractAddress !== "" ||
    deploymentState.suicidal1.contractAddress !== "" ||
    deploymentState.suicidal2.contractAddress !== ""
  )
}
