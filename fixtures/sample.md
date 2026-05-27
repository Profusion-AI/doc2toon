# Converter Sample

This fixture has commas, quotes, and "quoted text" so escaping is handled by the official encoder.

## Checklist

- Parse Markdown into canonical JSON
- Encode with `@toon-format/toon`
- Decode and validate the round trip

> TOON is an encoding layer, not a prose format.

```js
console.log("official encoder, please");
```

| Input | Status |
| --- | --- |
| Markdown | Supported |
| Text | Supported |
