# `.keystep` file format — findings log

Nothing confirmed yet. Fill in as test patterns from `docs/test-patterns.md`
are exported and diffed.

Template per finding:

```
## Offset 0x?? — <field name>
- Isolated by: <which pattern pair, e.g. A vs B>
- Size: <N bytes>
- Encoding: <e.g. raw MIDI note number, little/big endian, enum, ...>
- Value mapping: <e.g. 0x00 = C-2 ... matches MIDI note number directly>
- Confidence: <confirmed / suspected / unconfirmed>
```
