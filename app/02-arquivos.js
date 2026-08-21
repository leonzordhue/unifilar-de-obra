/* Leitura de KML e KMZ do usuario. */
/* ---------------------------------------------------------------- KML / KMZ */

function lerKML(texto){
  const doc = new DOMParser().parseFromString(texto, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('o XML do arquivo está inválido.');
  const linhas = [];
  doc.querySelectorAll('LineString > coordinates, LinearRing > coordinates').forEach(c => {
    const pts = c.textContent.trim().split(/\s+/).map(t => {
      const v = t.split(',');
      return [parseFloat(v[0]), parseFloat(v[1])];
    }).filter(p => isFinite(p[0]) && isFinite(p[1]));
    if (pts.length > 1) linhas.push(pts);
  });
  if (!linhas.length)
    throw new Error('nenhum traçado de linha encontrado. Verifique se o KML tem LineString.');
  const n = doc.querySelector('Document > name, Folder > name, Placemark > name');
  return {nome: ((n && n.textContent) || '').trim() || 'Traçado carregado', linhas};
}
async function lerArquivoGeo(file){
  if (file.name.toLowerCase().endsWith('.kmz')){
    if (typeof JSZip === 'undefined')
      throw new Error('a biblioteca de leitura de KMZ não carregou — verifique a internet.');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const alvo = Object.keys(zip.files).find(n => n.toLowerCase().endsWith('.kml'));
    if (!alvo) throw new Error('o KMZ não contém KML interno.');
    return lerKML(await zip.files[alvo].async('string'));
  }
  return lerKML(await file.text());
}
