# `contracts/extensions/ApprovalPreInteraction.sol`

**Role:** contract-maker helper. LOP calls its pre-interaction; it verifies order maker is itself and approves the calling LOP for current making amount. It validates signatures against a separately configured real maker (`11-48`).

**Security:** only configured immutable owner may trigger approvals. This is a powerful contract-maker pattern: configure owner/maker correctly and review token approval reset behavior. An EIP-1271 return is standard magic or `0xffffffff`.
