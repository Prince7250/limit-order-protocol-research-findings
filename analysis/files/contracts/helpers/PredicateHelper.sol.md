# `contracts/helpers/PredicateHelper.sol`

**Role:** composition/utility predicate contract inherited by LOP. `or`, `and`, `not`, `eq`, `lt`, and `gt` recursively static-call the LOP with encoded predicate payloads; `arbitraryStaticCall` targets an external view source (`11-74`).

**Security:** `_staticcallForUint` accepts only exact 32-byte return data (`76-86`), avoiding loose ABI decoding. Staticcall prevents state writes but untrusted target code may revert or exhaust gas; false/revert becomes a failed predicate except direct `arbitraryStaticCall`, which reverts.
