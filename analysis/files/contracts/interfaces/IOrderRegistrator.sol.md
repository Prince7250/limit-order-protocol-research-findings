# `contracts/interfaces/IOrderRegistrator.sol`

**Role:** signed-order announcement ABI. Defines duplicate error, full order/extension/signature event, `registerOrder`, and `announcedAt` getter (`12-40`).

**Security:** registration is not filling or cancellation. Relayers may submit a valid signed order; the timestamp merely records first announcement and has no core LOP enforcement role.
