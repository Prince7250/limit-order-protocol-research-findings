# `contracts/mocks/InteractionMock.sol`

Test-only interaction fixture used to exercise pre/taker/post callback ordering and forwarding. It intentionally makes external calls and therefore demonstrates atomic rollback/composability rather than providing production hardening.
