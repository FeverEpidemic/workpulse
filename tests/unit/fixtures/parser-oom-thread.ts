// Test-only parser thread entry that exhausts its heap limit.
const hoard: string[][] = [];
for (;;) {
  hoard.push(Array.from({ length: 100_000 }, (_, index) => `chunk-${hoard.length}-${index}`));
}
