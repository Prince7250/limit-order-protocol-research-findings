# `contracts/extensions/OrderIdInvalidator.sol`

**Role:** maker-signed pre-interaction that binds a 32-bit order ID to the first order hash seen. The LOP-only caller restriction is immutable (`18-32`).

**Function:** `preInteraction` stores first `(maker,id)->hash`; later same hash succeeds, different hash reverts (`34-51`).

**Security:** `extraData` needs at least four bytes or slicing/cast fails. It offers uniqueness across orders using this exact extension, not global LOP cancellation.
