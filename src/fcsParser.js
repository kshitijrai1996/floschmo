// FCS 3.0 / 3.1 parser. Handles $DATATYPE=F (float32) and $DATATYPE=I (int).
// Returns { params: [{name, range}], events: Float32Array[N*P], totalEvents, par }

export async function parseFCS(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  const headerText = new TextDecoder('latin1').decode(bytes.subarray(0, 58));
  const version = headerText.slice(0, 6).trim();
  if (!/^FCS\d/.test(version)) throw new Error('not an FCS file');
  const textStart = parseInt(headerText.slice(10, 18).trim(), 10);
  const textEnd = parseInt(headerText.slice(18, 26).trim(), 10);
  if (!(textStart > 0 && textEnd > textStart && textEnd < bytes.length)) {
    throw new Error('the file header is damaged or incomplete');
  }
  let dataStart = parseInt(headerText.slice(26, 34).trim(), 10);
  let dataEnd = parseInt(headerText.slice(34, 42).trim(), 10);

  const textBytes = bytes.subarray(textStart, textEnd + 1);
  const delim = String.fromCharCode(textBytes[0]);
  const text = new TextDecoder('latin1').decode(textBytes);
  const parts = text.split(delim);
  const meta = {};
  for (let i = 1; i < parts.length - 1; i += 2) {
    meta[parts[i].toUpperCase()] = parts[i + 1];
  }

  if (dataStart === 0 && meta['$BEGINDATA']) dataStart = parseInt(meta['$BEGINDATA'], 10);
  if (dataEnd === 0 && meta['$ENDDATA']) dataEnd = parseInt(meta['$ENDDATA'], 10);

  const par = parseInt(meta['$PAR'], 10);
  const tot = parseInt(meta['$TOT'], 10);
  const datatype = meta['$DATATYPE'];
  const byteord = meta['$BYTEORD'];
  const mode = meta['$MODE'];

  if (mode && mode !== 'L') throw new Error(`unsupported acquisition mode "${mode}" (only list mode is supported)`);
  if (!(par > 0) || !(tot >= 0)) throw new Error('missing parameter or event counts ($PAR / $TOT)');
  if (!['F', 'D', 'I'].includes(datatype)) throw new Error(`unsupported data type "${datatype}"`);
  if (!(dataStart > 0 && dataEnd >= dataStart) && tot > 0) throw new Error('the data segment is missing');
  if (dataEnd > bytes.length) throw new Error('the file is truncated (data segment runs past the end of the file)');

  const params = [];
  for (let i = 1; i <= par; i++) {
    params.push({
      name: meta[`$P${i}N`] || `P${i}`,
      stain: meta[`$P${i}S`] || '',
      range: parseFloat(meta[`$P${i}R`]) || 262144,
      bits: parseInt(meta[`$P${i}B`], 10),
      voltage: meta[`$P${i}V`] || '',
    });
  }

  const dataBytes = bytes.subarray(dataStart, dataEnd + 1);
  const dv = new DataView(dataBytes.buffer, dataBytes.byteOffset, dataBytes.byteLength);
  const littleEndian = byteord === '1,2,3,4' || byteord === '1,2';

  const totalValues = tot * par;
  const events = new Float32Array(totalValues);

  if (datatype === 'F') {
    for (let i = 0; i < totalValues; i++) {
      events[i] = dv.getFloat32(i * 4, littleEndian);
    }
  } else if (datatype === 'D') {
    for (let i = 0; i < totalValues; i++) {
      events[i] = dv.getFloat64(i * 8, littleEndian);
    }
  } else if (datatype === 'I') {
    let cursor = 0;
    for (let e = 0; e < tot; e++) {
      for (let p = 0; p < par; p++) {
        const bits = params[p].bits;
        if (bits === 16) {
          events[e * par + p] = dv.getUint16(cursor, littleEndian);
          cursor += 2;
        } else if (bits === 32) {
          events[e * par + p] = dv.getUint32(cursor, littleEndian);
          cursor += 4;
        } else if (bits === 8) {
          events[e * par + p] = dv.getUint8(cursor);
          cursor += 1;
        } else {
          throw new Error(`Unsupported integer bit depth: ${bits}`);
        }
      }
    }
  } else {
    throw new Error(`Unsupported $DATATYPE: ${datatype}`);
  }

  return {
    version,
    params,
    events,
    totalEvents: tot,
    par,
    meta,
  };
}

// Get a single parameter column as a Float32Array
export function getColumn(parsed, paramIndex) {
  const { events, par, totalEvents } = parsed;
  const col = new Float32Array(totalEvents);
  for (let i = 0; i < totalEvents; i++) {
    col[i] = events[i * par + paramIndex];
  }
  return col;
}

// Apply biexponential-ish display transform: signed log for negative-tolerant scaling.
// Simple asinh transform — close to FlowJo's biexp for visual purposes.
export function asinhTransform(x, cofactor = 150) {
  return Math.asinh(x / cofactor);
}

export function asinhInverse(y, cofactor = 150) {
  return Math.sinh(y) * cofactor;
}
