const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
let html = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8');
for (const [marker, file] of [['THEME_INIT','src/theme.js'],['STYLES','src/styles.css'],['DIMENSION_STYLES','src/dimensions.css'],['PHOTO_STYLES','src/photo.css'],['SHARING_STYLES','src/sharing.css'],['THEME_STYLES','src/theme.css'],['THREE','vendor/three.min.js'],['CABINETS','src/cabinets.js'],['ISLANDS','src/islands.js'],['AI_SCHEMA','src/ai-schema.js'],['PHOTO_MODEL','src/photo-model.js'],['PHOTO_UI','src/photo-ui.js'],['APP','src/app.js']]) {
  const content = fs.readFileSync(path.join(root,file),'utf8').replace(/<\/script/gi,'<\\/script');
  html = html.replace('/* '+marker+' */', () => content);
}
const license=fs.readFileSync(path.join(root,'vendor/THREE-LICENSE.txt'),'utf8');
html=html.replace('<!doctype html>','<!doctype html>\n<!-- Three.js r160.1, bundled for offline use.\n'+license+'\n-->');
fs.writeFileSync(path.join(root,'configurator-mobilier.html'),html,'utf8');
fs.mkdirSync(path.join(root,'dist'),{recursive:true});
fs.writeFileSync(path.join(root,'dist/index.html'),html,'utf8');
console.log('Built configurator-mobilier.html and dist/index.html ('+Math.round(Buffer.byteLength(html)/1024)+' KB each, self-contained)');
