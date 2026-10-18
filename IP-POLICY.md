# Intellectual property policy (draft)

> Draft for discussion. This is not legal advice; have counsel review it before Saydo accepts outside contributions to the specification.

Saydo has two kinds of material, and they are licensed differently.

| Material | Where | License |
|---|---|---|
| Code (reference implementation, CLI, templates, tests) | `packages/`, `examples/` | [MIT](LICENSE) |
| Specification text | `SPEC.md` and future spec documents | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

## Patent commitment for the specification

Anyone should be able to implement the Saydo Protocol, in any language and on any platform, without asking permission or paying royalties.

Contributors to the specification therefore make the commitment of the [Open Web Foundation Final Specification Agreement (OWFa 1.0)](https://www.openwebfoundation.org/the-agreements/the-owf-1-0-agreements-granted-claims/owfa-1-0) for the claims necessary to implement the parts they contributed. In short, this is a perpetual, worldwide, royalty-free patent non-assert, with a defensive termination clause.

Contributors make this commitment by opening a pull request that changes the specification. The pull request template restates it.

## Contributions

- Every commit carries a [Developer Certificate of Origin](https://developercertificate.org/) sign-off (`git commit -s`). It certifies that you have the right to submit the work under the licenses above.
- Normative changes (anything with MUST, SHOULD or MAY, or any change to a message shape) go through an RFC pull request. It stays open for at least 14 days and needs approval from two maintainers. At least one of them must not work for the author's employer.
- An implementation-only change does not change the protocol and needs no RFC.

## Names

"Saydo" names the specification and the reference implementation. Other implementations may say they "implement the Saydo Protocol" when they pass the conformance suite (SPEC.md §13) at a stated level, for example "Saydo L2". Please do not imply endorsement, or name a fork "Saydo" without a qualifier.

## Path to a standards body

Before v1.0, the maintainers intend to move the specification to a neutral venue: a W3C Community Group, or a working group under a foundation that already hosts agent protocols. That venue's IP policy will then replace this one. Commitments already made under OWFa 1.0 stay in force.
