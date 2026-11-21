// One colour per sample, shared by the sidebar and stacked histograms.
export const SAMPLE_PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
];

export const sampleColor = (index) => SAMPLE_PALETTE[index % SAMPLE_PALETTE.length];
