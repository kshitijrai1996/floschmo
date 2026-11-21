<p align="center">
  <img src="public/icon-192.png" width="96" alt="FloSchmo logo" />
</p>

<h1 align="center">FloSchmo</h1>

<p align="center"><b>Flow analysis for any Jo Schmo.</b><br/>
Free, private, and right in your browser — on macOS, Windows and Linux.</p>

<p align="center">
  <a href="https://kshitijrai1996.github.io/floschmo/"><b>▶ Open FloSchmo</b></a>
</p>

---

FloSchmo is a flow cytometry analysis app that runs entirely in your web browser. There is nothing to
install: open the link, drop in your `.fcs` files, and start gating. No account, no licence dongle.

> **Your data stays on your computer.** FCS files are read locally by your browser and are never
> uploaded anywhere. There is no server — FloSchmo is a static web page.

## What it does

| | |
|---|---|
| **Gating** | Rectangle, polygon, quadrant and range gates in a nested hierarchy. Draw on a gated plot to create a child gate. Move, resize, rename, undo and redo. |
| **Plots** | Pseudocolor density, contour and dot plots; smoothed histograms; stacked histograms across samples. Linear, log and biexponential axes with adjustable limits. |
| **Samples** | One gating tree applies to every sample. The sample table shows % of parent, counts and a statistic of your choice per gate, and exports to CSV. |
| **Statistics** | Mean, geometric mean, median, SD, CV and robust CV for every parameter in any gate. |
| **Compensation** | Compute a spillover matrix from single-stain controls, or edit it by hand. |
| **Export** | Single plots or lettered multi-panel figures as SVG (fully editable in Illustrator / Inkscape) or PNG. |
| **Workspaces** | Save gates, plots and settings to a small `.floschmo.json` file; your session is also autosaved in the browser. |

Reads FCS 3.0 / 3.1 list-mode files with float, double or integer data.

## Using it

1. Open the app and **drop `.fcs` files** anywhere on the window (or click **Import FCS**).
   No data handy? Click **Try the demo data** — it is synthetic and generated on the spot.
2. Pick a gate tool and draw on a plot.
3. Add plots, switch samples in the sidebar, and open the **Sample table** to compare everything.
4. **Save** the workspace, or export figures.

Press <kbd>?</kbd> in the app for a quick-start guide and the keyboard shortcuts.

### Install it as an app (optional)

FloSchmo can be installed so it opens in its own window and works offline:

- **Chrome / Edge (Windows, macOS, Linux):** click the install icon in the address bar, or *Menu → Install FloSchmo*.
- **Safari (macOS):** *File → Add to Dock*.

## Run it locally

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/kshitijrai1996/floschmo.git
cd floschmo
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173).

To make a production build: `npm run build` (output in `dist/`), and `npm run preview` to try it.
The build uses relative paths, so `dist/` can be hosted from any static web server or folder path.

## Deploying your own copy

This repository deploys itself to GitHub Pages with the workflow in
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

1. Fork or push this repository to GitHub.
2. In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`. A minute or two later the app is live at `https://<user>.github.io/<repository>/`.

## Project layout

```
src/
  App.jsx                 application shell, state, workspace save/load
  ScatterPlot.jsx         scatter plots and 2D gates (rectangle, polygon, quadrant)
  Histogram.jsx           histograms and range gates
  StackedHistogram.jsx    one histogram row per sample
  SampleTable.jsx         per-sample statistics table and CSV export
  CompensationDialog.jsx  spillover matrix editor
  fcsParser.js            FCS 3.0 / 3.1 reader
  gateUtils.js            gate masks, hierarchy and statistics
  compensation.js         spillover estimation and compensation math
  density.js              pseudocolor / contour rendering
  scales.js, smoothing.js axis transforms and histogram smoothing
  exportUtils.js          SVG / PNG / figure export
  demoData.js             synthetic demo dataset
public/
  sw.js                   service worker (offline support)
  manifest.webmanifest    install metadata
```

Built with React, Vite and D3.

## Things to know

- **For research use only.** Not for clinical or diagnostic use. Check results that matter against
  your established analysis pipeline.
- The "biexp" axis is an arcsinh transform with an adjustable cofactor — similar in spirit to, but not
  identical with, FlowJo's biexponential or the Logicle transform.
- Compensation applies to fluorescence **area** (`-A`) parameters.
- Plots are drawn as vector graphics, so very large files (hundreds of thousands of events) will feel slow.
- **Do not commit FCS files to this repository.** `.gitignore` blocks them and the deploy workflow
  refuses to publish if any are tracked.

## Licence

[MIT](LICENSE) — free to use, modify and share.

## Disclaimer

FloSchmo is an independent project. It is not affiliated with, endorsed by, or connected to FlowJo or
BD (Becton, Dickinson and Company). FlowJo is a trademark of its respective owner.
