# `contracts/interfaces/ICreate3Deployer.sol`

**Role:** two-function external deployment interface: `deploy(salt, code)` and deterministic `addressOf(salt)`.

**Security:** deployment scripts, not core LOP, select the Create3 deployer. An incorrect configured deployer/salt compromises address reproducibility and must be verified on each chain.
