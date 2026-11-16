interface QrProps {
  value: string;
  size?: number;
}

export function QrMatrix({ value, size = 136 }: QrProps) {
  const cells = 17;
  const grid: boolean[][] = Array.from({ length: cells }, (_, r) =>
    Array.from({ length: cells }, (_, c) => {
      const inFinderTL = r < 5 && c < 5;
      const inFinderTR = r < 5 && c >= cells - 5;
      const inFinderBL = r >= cells - 5 && c < 5;
      if (inFinderTL || inFinderTR || inFinderBL) {
        const lr = r >= cells - 5 ? r - (cells - 5) : r;
        const lc = c >= cells - 5 ? c - (cells - 5) : c;
        return lr === 0 || lr === 4 || lc === 0 || lc === 4 || (lr === 2 && lc === 2);
      }
      const charCode = value.charCodeAt((r * cells + c) % Math.max(1, value.length)) || 65;
      return ((charCode + r * 7 + c * 13) % 3) === 0;
    })
  );

  return (
    <div
      className="inline-flex items-center justify-center rounded-lg bg-white p-2.5"
      style={{ width: size, height: size }}
      aria-label="Código QR de dirección de depósito"
    >
      <svg viewBox={`0 0 ${cells} ${cells}`} className="h-full w-full">
        {grid.map((row, r) =>
          row.map((on, c) =>
            on ? <rect key={`${r}-${c}`} x={c} y={r} width={0.92} height={0.92} fill="#090B10" rx={0.12} /> : null
          )
        )}
      </svg>
    </div>
  );
}
