(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const T = window.THREE;
  const FEATURES = {photoImport:true};
  const PRESETS = {
    oak: { name: 'Stejar & alb cald', top: '#eeeae1', fronts: '#b98c60', body: '#b98c60', topFinish: 'stone', frontsFinish: 'wood', bodyFinish: 'wood' },
    cashmere: { name: 'Cașmir & nuc', top: '#866247', fronts: '#e7dfd2', body: '#ded6c9', topFinish: 'wood', frontsFinish: 'matte', bodyFinish: 'matte' },
    sage: { name: 'Salvie & stejar', top: '#c5a277', fronts: '#87927b', body: '#eff0e7', topFinish: 'wood', frontsFinish: 'matte', bodyFinish: 'matte' }
  };
  const MODELS = {
    custom: { title: 'Dulap vitrină', description: 'Depozitare generoasă. Detalii la vedere.', index: '01', builder: o => window.FurnitureCabinets.buildCustom(o) },
    bar: { title: 'Bar & masă extensibilă', description: 'Un loc de întâlnire. Mai mult spațiu, la nevoie.', index: '02', builder: o => window.FurnitureIslands.buildBar(o) },
    photo: { title: 'Mobilier din fotografie', description: 'Interpretare 3D editabilă. Dimensiuni orientative.', index: '03', builder: o => window.FurniturePhotoModel.build({...o,photo:o.photo.descriptor}) }
  };
  const STORAGE = 'forma-furniture-v1';
  const APPEARANCE_PARAM = 'finisaje';
  const CONFIGURATION_PARAM = 'config';
  const MATERIAL_ROLES = ['top', 'fronts', 'body'];
  const FINISH_LABELS = {wood:'Lemn', matte:'Mat', stone:'Piatră'};
  function appearancePayload() {
    const payload = {v:1};
    for (const role of MATERIAL_ROLES) {
      payload[role] = state[role];
      payload[role+'Finish'] = state[role+'Finish'];
    }
    return payload;
  }
  function decodeSharedData(token, maxLength) {
    if (!token || token.length > maxLength || !/^[A-Za-z0-9_-]+$/.test(token) || token.length % 4 === 1) throw new Error('Link invalid.');
    const json = atob(token.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(token.length/4)*4,'='));
    const data = JSON.parse(json);
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1) throw new Error('Versiune necunoscută.');
    return data;
  }
  function decodeAppearance(token) {
    const data = decodeSharedData(token,1024);
    const appearance = {};
    // Copy only validated material fields; a shared palette cannot replace the project.
    for (const role of MATERIAL_ROLES) {
      if (typeof data[role] !== 'string' || !/^#[0-9a-f]{6}$/i.test(data[role]) || typeof data[role+'Finish'] !== 'string' || !Object.hasOwn(FINISH_LABELS,data[role+'Finish'])) throw new Error('Culoare sau finisaj invalid.');
      appearance[role] = data[role].toLowerCase();
      appearance[role+'Finish'] = data[role+'Finish'];
    }
    return appearance;
  }
  function configurationPayload() {
    return {
      ...appearancePayload(), model:state.model,
      sizes:{custom:state.sizes.custom,bar:state.sizes.bar}, worktops:state.worktops,
      extension:state.extension, glass:state.glass, doorsOpen:state.doorsOpen, dimensions:state.dimensions
    };
  }
  function decodeConfiguration(token) {
    const data = decodeSharedData(token,8192);
    if (!['custom','bar'].includes(data.model)) throw new Error('Model necunoscut.');
    for (const key of ['glass','doorsOpen','dimensions']) {
      if (typeof data[key] !== 'boolean') throw new Error('Opțiune invalidă.');
    }
    if (!data.sizes || typeof data.sizes !== 'object' || Array.isArray(data.sizes) || !data.sizes.custom || !data.sizes.bar || !data.worktops || typeof data.worktops !== 'object' || Array.isArray(data.worktops)) throw new Error('Lipsesc dimensiunile sau blaturile.');
    // Reuse project validation, requiring every shared dimension and top setting.
    // Photo data is local-only and never accepted from a compact configuration link.
    return validate({...data,photo:null,sizes:{custom:data.sizes.custom,bar:data.sizes.bar}});
  }
  function shareUrl(mode = shareLinkMode || 'configuration') {
    const url = new URL(window.location.href);
    const full = mode === 'configuration';
    const payload = full ? configurationPayload() : appearancePayload();
    // Both schemas contain only ASCII identifiers, HEX colors and numeric settings.
    const token = btoa(JSON.stringify(payload)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    url.searchParams.delete(full ? APPEARANCE_PARAM : CONFIGURATION_PARAM);
    url.searchParams.set(full ? CONFIGURATION_PARAM : APPEARANCE_PARAM,token);
    return url.href;
  }
  const SIZE_FIELDS = {
    custom: {
      width: {label:'Lățime', min:120, max:320, value:200},
      depth: {label:'Adâncime', min:30, max:90, value:50},
      height: {label:'Înălțime', min:160, max:280, value:215},
      counterHeight: {label:'Înălțime blat', min:60, max:110, value:90},
      upperDepth: {label:'Adâncime sus', min:20, max:60, value:30},
      nicheHeight: {label:'Înălțime nișă', min:25, max:80, value:47.5}
    },
    bar: {
      width: {label:'Lățime corp', min:50, max:160, value:80},
      depth: {label:'Adâncime corp', min:50, max:130, value:90},
      height: {label:'Înălțime bar', min:90, max:140, value:110},
      tableLength: {label:'Lungime masă max.', min:40, max:180, value:110},
      tableDepth: {label:'Adâncime masă', min:40, max:130, value:90},
      tableHeight: {label:'Înălțime masă', min:60, max:100, value:76}
    },
    photo: {
      width: {label:'Lățime', min:20, max:400, value:100},
      depth: {label:'Adâncime', min:10, max:180, value:50},
      height: {label:'Înălțime', min:20, max:300, value:100}
    }
  };
  function defaultSize(model) {return Object.fromEntries(Object.entries(SIZE_FIELDS[model]).map(([key,field])=>[key,field.value]));}
  const defaultWorktop=()=>({widthDelta:0,depthDelta:0,offsetX:0,offsetZ:0});
  const defaults = () => ({ model: 'custom', palette: 'sage', ...PRESETS.sage, extension: 1, glass: true, doorsOpen: false, dimensions: false, photo:null, sizes:{custom:defaultSize('custom'),bar:defaultSize('bar'),photo:defaultSize('photo')},worktops:{cabinet:defaultWorktop(),bar:defaultWorktop(),table:defaultWorktop()} });
  const WORKTOP_LIMITS={width:{min:20,max:450},depth:{min:10,max:220},offsetX:{min:-100,max:100},offsetZ:{min:-100,max:100}};
  function baseWorktop(key) {
    if(key==='cabinet')return {width:state.sizes.custom.width,depth:state.sizes.custom.depth};
    if(key==='bar')return {width:state.sizes.bar.width,depth:state.sizes.bar.depth+20};
    return {width:extensionLength()+0.5,depth:state.sizes.bar.tableDepth};
  }
  function resolvedWorktop(key) {
    const base=baseWorktop(key),saved=state.worktops[key];
    return {width:Math.round(Math.min(450,Math.max(20,base.width+saved.widthDelta))*10)/10,depth:Math.round(Math.min(220,Math.max(10,base.depth+saved.depthDelta))*10)/10,offsetX:saved.offsetX,offsetZ:saved.offsetZ};
  }
  function resolvedWorktops(){return Object.fromEntries(['cabinet','bar','table'].map(key=>[key,resolvedWorktop(key)]));}
  function resetModelWorktops(){for(const key of state.model==='custom'?['cabinet']:state.model==='bar'?['bar','table']:[])state.worktops[key]=defaultWorktop();}
  function sizeLimit(model,key,size) {
    let max=SIZE_FIELDS[model][key].max;
    if(model==='custom') {
      if(key==='counterHeight')max=Math.min(max,size.height-55);
      if(key==='nicheHeight')max=Math.min(max,size.height-size.counterHeight-30);
      if(key==='upperDepth')max=Math.min(max,size.depth);
    } else {
      if(key==='tableDepth')max=Math.min(max,size.depth);
      if(key==='tableHeight')max=Math.min(max,size.height-25);
    }
    return {min:SIZE_FIELDS[model][key].min,max:Math.round(max*10)/10};
  }
  function normalizeSize(model,size) {
    const next={...size};
    // Main dimensions anchor the dependent compartments and table dimensions.
    for(const key of Object.keys(SIZE_FIELDS[model])) {
      const limits=sizeLimit(model,key,next);
      next[key]=Math.round(Math.min(limits.max,Math.max(limits.min,next[key]))*10)/10;
    }
    return next;
  }
  function validate(data) {
    if (!data || typeof data !== 'object' || !Object.hasOwn(MODELS, data.model)) throw new Error('Proiectul nu conține un model compatibil.');
    const result = defaults();
    result.model = data.model;
    if(data.photo!=null)result.photo=validatePhoto(data.photo);
    if(data.model==='photo'&&!result.photo)throw new Error('Proiectul nu conține modelul generat din fotografie.');
    for (const key of ['top', 'fronts', 'body']) {
      if (typeof data[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(data[key])) throw new Error('Proiectul conține un cod de culoare invalid.');
      result[key] = data[key].toLowerCase();
      const finish = data[key + 'Finish'];
      if (!['wood', 'matte', 'stone'].includes(finish)) throw new Error('Finisaj necunoscut.');
      result[key + 'Finish'] = finish;
    }
    if (typeof data.extension !== 'number' || !Number.isFinite(data.extension) || data.extension < 0 || data.extension > 1) throw new Error('Extensia trebuie să fie între 0 și 1.');
    result.extension = data.extension;
    for (const key of ['glass', 'doorsOpen', 'dimensions']) result[key] = data[key] === true;
    if(data.sizes !== undefined) {
      if(!data.sizes || typeof data.sizes!=='object')throw new Error('Dimensiunile proiectului sunt invalide.');
      for(const model of Object.keys(SIZE_FIELDS)) {
        const values=data.sizes[model];
        if(model==='photo'&&values===undefined&&data.model!=='photo')continue;
        if(!values || typeof values!=='object')throw new Error('Lipsesc dimensiunile unui model.');
        for(const key of Object.keys(SIZE_FIELDS[model])) {
          const value=values[key],limits=sizeLimit(model,key,values);
          if(typeof value!=='number'||!Number.isFinite(value)||value<limits.min||value>limits.max)throw new Error('Dimensiune invalidă: '+SIZE_FIELDS[model][key].label+'.');
          result.sizes[model][key]=Math.round(value*10)/10;
        }
      }
    }
    if(data.worktops!==undefined) {
      if(!data.worktops||typeof data.worktops!=='object')throw new Error('Setările blaturilor sunt invalide.');
      for(const key of ['cabinet','bar','table']) {
        const values=data.worktops[key];if(!values||typeof values!=='object')throw new Error('Lipsesc setările unui blat.');
        for(const field of ['widthDelta','depthDelta','offsetX','offsetZ']) {
          const value=values[field],limit=field==='widthDelta'?450:field==='depthDelta'?220:100;
          if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>limit)throw new Error('Dimensiune sau poziție invalidă pentru blat.');
          result.worktops[key][field]=Math.round(value*10)/10;
        }
      }
    }
    result.palette = matchedPalette(result);
    return result;
  }
  function validatePhoto(value) {
    if(!value||typeof value!=='object')throw new Error('Datele fotografiei sunt invalide.');
    const descriptor=window.FurniturePhotoModel.validateDescriptor(value.descriptor);
    if(typeof value.thumbnail!=='string'||value.thumbnail.length>220000||!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.thumbnail))throw new Error('Previzualizarea fotografiei este invalidă.');
    const initialSize={};
    for(const [key,field] of Object.entries(SIZE_FIELDS.photo)) {
      const n=value.initialSize&&value.initialSize[key];
      if(typeof n!=='number'||!Number.isFinite(n)||n<field.min||n>field.max)throw new Error('Dimensiunile fotografiei sunt invalide.');
      initialSize[key]=Math.round(n*10)/10;
    }
    return {descriptor,thumbnail:value.thumbnail,name:typeof value.name==='string'?value.name.replace(/[\x00-\x1f]/g,'').slice(0,80):'Obiect importat',initialSize};
  }
  function matchedPalette(data) {
    return Object.keys(PRESETS).find(key => ['top', 'fronts', 'body', 'topFinish', 'frontsFinish', 'bodyFinish'].every(prop => data[prop] === PRESETS[key][prop])) || null;
  }
  let state = defaults();
  let storageAvailable = true;
  try { const saved = localStorage.getItem(STORAGE); if (saved) state = validate(JSON.parse(saved)); }
  catch (_) { /* Start clean when an old project or browser policy prevents loading. */ }
  let shareLinkMode = null, shareLoadMessage = '';
  const incomingParams = new URL(window.location.href).searchParams;
  const sharedConfigurations = incomingParams.getAll(CONFIGURATION_PARAM);
  const sharedAppearances = incomingParams.getAll(APPEARANCE_PARAM);
  if (sharedConfigurations.length) {
    try {
      if (sharedConfigurations.length !== 1) throw new Error('Parametru duplicat.');
      const restored = decodeConfiguration(sharedConfigurations[0]);
      state = {...restored,photo:state.photo,sizes:{...restored.sizes,photo:state.sizes.photo}};
      shareLinkMode = 'configuration';
      shareLoadMessage = 'Configurația din link a fost aplicată: dimensiuni, blaturi, culori și funcții.';
    } catch (_) {
      shareLoadMessage = 'Linkul conține o configurație invalidă. Proiectul existent a fost păstrat.';
    }
  } else if (sharedAppearances.length) {
    try {
      if (sharedAppearances.length !== 1) throw new Error('Parametru duplicat.');
      Object.assign(state,decodeAppearance(sharedAppearances[0]));
      state.palette = matchedPalette(state);
      shareLinkMode = 'appearance';
      shareLoadMessage = 'Culorile și finisajele din link au fost aplicate.';
    } catch (_) {
      shareLoadMessage = 'Linkul conține culori sau finisaje invalide. Configurația existentă a fost păstrată.';
    }
  }
  function persist() {
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); }
    catch (_) {
      if (storageAvailable) document.querySelector('.sidebar-footer').textContent = 'Folosește „Salvează proiect” pentru a păstra configurația.';
      storageAvailable = false;
    }
  }
  let toastTimer;
  function toast(text) { $('toast').textContent = text; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3200); }
  const fmt = n => new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 1 }).format(n);

  let renderer;
  try {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (error) {
    $('loading').innerHTML = '<div style="max-width:340px;padding:24px;text-align:center">Vizualizarea 3D necesită WebGL. Deschide acest HTML în Chrome, Edge sau Firefox cu accelerarea grafică activată.</div>';
    console.error(error);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  $('viewport').appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(34, 1, 1, 5000);
  scene.add(new T.HemisphereLight(0xffffff, 0xafa895, 1.8));
  const sun = new T.DirectionalLight(0xfff5e9, 2.6);
  sun.position.set(-180, 360, 260); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -270, right: 270, top: 280, bottom: -250, near: 1, far: 1000 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.12;
  sun.shadow.radius = 3; scene.add(sun);
  const fill = new T.DirectionalLight(0xe9f0ff, 1.3); fill.position.set(240, 150, -220); scene.add(fill);
  const floor = new T.Mesh(new T.PlaneGeometry(1800, 1800), new T.ShadowMaterial({ color: 0x5c6350, opacity: 0.18 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.08; floor.receiveShadow = true; scene.add(floor);
  const grid = new T.GridHelper(800, 40, 0xb7c1ab, 0xb7c1ab);
  grid.position.y = -0.12; grid.material.transparent = true; grid.material.opacity = 0.065; grid.material.depthWrite = false; scene.add(grid);
  let model = null, dimensions = null, metrics = { width: 200, height: 215, depth: 50 };
  let modelBounds={minX:-100,maxX:100,minZ:-25,maxZ:25};
  let theta = 0.42, phi = 1.3, radius = 500, fitRadius = 500;
  const target = new T.Vector3(0, 108, 0);
  let dirty = true, pendingRebuild = false, pendingRefit = false;
  function dispose(group) {
    if (!group) return;
    const geometries = new Set(), materials = new Set(), textures = new Set();
    group.traverse(obj => {
      if (obj.geometry) geometries.add(obj.geometry);
      const list = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      list.forEach(mat => { materials.add(mat); for (const value of Object.values(mat)) if (value && value.isTexture) textures.add(value); });
    });
    geometries.forEach(x => x.dispose()); materials.forEach(x => x.dispose()); textures.forEach(x => x.dispose());
    scene.remove(group);
  }
  function labelSprite(text) {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 80;
    const ctx = canvas.getContext('2d');
    const dark = window.FormaTheme.getTheme() === 'dark';
    ctx.fillStyle = dark ? 'rgba(29,40,32,0.96)' : 'rgba(249,250,244,0.94)'; ctx.beginPath(); ctx.roundRect(2, 2, 316, 76, 16); ctx.fill();
    ctx.fillStyle = dark ? '#d7e4cd' : '#526449'; ctx.font = '500 33px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 160, 41);
    const map = new T.CanvasTexture(canvas); map.colorSpace = T.SRGBColorSpace;
    const sprite = new T.Sprite(new T.SpriteMaterial({ map, depthTest: false, transparent: true }));
    sprite.scale.set(45, 11.25, 1); sprite.renderOrder = 20;
    return sprite;
  }
  function makeDimensions() {
    dispose(dimensions); dimensions = new T.Group();
    const h = metrics.height;
    const {minX,maxX,minZ,maxZ}=modelBounds,centerX=(minX+maxX)/2,centerZ=(minZ+maxZ)/2;
    const mat = new T.LineBasicMaterial({ color: window.FormaTheme.getTheme()==='dark'?0xb0c69c:0x86947b, depthTest: false, transparent: true, opacity: 0.8 });
    function line(points) { const obj = new T.Line(new T.BufferGeometry().setFromPoints(points.map(p => new T.Vector3(...p))), mat); obj.renderOrder = 10; dimensions.add(obj); }
    const z = maxZ + 11, bottom = 4;
    line([[minX,bottom,z],[maxX,bottom,z]]);
    for (const x of [minX,maxX]) line([[x,bottom-3,z],[x,bottom+3,z]]);
    const widthLabel = labelSprite(fmt(metrics.width) + ' cm'); widthLabel.position.set(centerX,bottom-8,z); dimensions.add(widthLabel);
    const x = minX-12;
    line([[x,0,centerZ],[x,h,centerZ]]);
    for(const y of [0,h]) line([[x-3,y,centerZ],[x+3,y,centerZ]]);
    const heightLabel = labelSprite(fmt(h) + ' cm'); heightLabel.position.set(x-5,h/2,centerZ); dimensions.add(heightLabel);
    line([[maxX+9,4,minZ],[maxX+9,4,maxZ]]);
    for (const dz of [minZ,maxZ]) line([[maxX+6,4,dz],[maxX+12,4,dz]]);
    const depthLabel = labelSprite(fmt(metrics.depth) + ' cm'); depthLabel.position.set(maxX+20,4,centerZ); dimensions.add(depthLabel);
    dimensions.visible = state.dimensions; scene.add(dimensions);
  }
  function syncTheme() {
    const dark = window.FormaTheme.getTheme() === 'dark';
    const action = dark ? 'Activează modul luminos' : 'Activează modul întunecat';
    $('themeToggle').setAttribute('aria-pressed', String(dark));
    $('themeToggle').setAttribute('aria-label', action);
    $('themeToggle').title = action;
    floor.material.color.set(dark ? '#000000' : '#5c6350');
    floor.material.opacity = dark ? 0.32 : 0.18;
    grid.material.color.set(dark ? '#e5f0df' : '#ffffff');
    grid.material.opacity = dark ? 0.1 : 0.065;
    if(model)makeDimensions();
    dirty = true;
  }
  function updateCamera() {
    camera.position.set(target.x + radius*Math.sin(phi)*Math.sin(theta), target.y+radius*Math.cos(phi), target.z+radius*Math.sin(phi)*Math.cos(theta));
    camera.lookAt(target); camera.updateMatrixWorld(); dirty = true;
  }
  function fit(resetAngles = false) {
    if (!model) return;
    if (resetAngles) { theta = state.model === 'bar' ? -0.52 : 0.42; phi = state.model === 'bar' ? 1.13 : 1.3; selectView('perspective'); }
    const box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3());
    box.getCenter(target); target.y = size.y * 0.50;
    const vertical = camera.fov * Math.PI / 180;
    const horizontal = 2*Math.atan(Math.tan(vertical/2)*camera.aspect);
    const width = Math.abs(size.x*Math.cos(theta)) + Math.abs(size.z*Math.sin(theta));
    const depth = Math.abs(size.x*Math.sin(theta)) + Math.abs(size.z*Math.cos(theta));
    fitRadius = Math.max((size.y*Math.sin(phi)+depth*Math.cos(phi))/2/Math.tan(vertical/2), width/2/Math.tan(horizontal/2)) * 1.24 + depth*0.35;
    radius = fitRadius; updateCamera();
  }
  let displayedSizeModel=null;
  function originalSize(model){return model==='photo'&&state.photo?{...state.photo.initialSize}:defaultSize(model);}
  function syncPhotoCard() {
    let card=$('photoModelCard');
    if(!state.photo){if(card)card.remove();return;}
    if(!card) {
      card=document.createElement('button');card.id='photoModelCard';card.className='model-card photo-model-card';card.dataset.model='photo';
      card.innerHTML='<img alt="Fotografia folosită pentru model"><span><strong>Mobilier din fotografie</strong><small class="photo-card-name"></small><small class="photo-card-size"></small></span><span class="selected-dot"></span>';
      document.querySelector('.model-grid').appendChild(card);
    }
    const img=card.querySelector('img');if(img.getAttribute('src')!==state.photo.thumbnail)img.src=state.photo.thumbnail;
    card.querySelector('.photo-card-name').textContent=state.photo.name;
    const p=state.sizes.photo;card.querySelector('.photo-card-size').textContent=fmt(p.width)+' × '+fmt(p.depth)+' × '+fmt(p.height)+' cm';
  }
  function syncSizeControls() {
    const size=state.sizes[state.model],fields=SIZE_FIELDS[state.model];
    if(displayedSizeModel!==state.model) {
      function fieldHTML(key) {
        return '<label class="size-field" for="size-'+key+'"><span>'+fields[key].label+'</span><span class="dimension-input"><input type="number" inputmode="decimal" id="size-'+key+'" data-size="'+key+'" step="0.1" aria-describedby="size-note"><span>cm</span></span></label>';
      }
      $('sizeBasicFields').innerHTML=['width','depth','height'].map(fieldHTML).join('');
      $('sizeDetailFields').innerHTML=Object.keys(fields).filter(key=>!['width','depth','height'].includes(key)).map(fieldHTML).join('');
      $('size-details').hidden=state.model==='photo';
      $('sizeDetailsLabel').textContent=state.model==='custom'?'Blat și compartimentare':'Dimensiunile mesei';
      $('size-note').textContent=state.model==='photo'?['Dimensiunile sunt estimări. Corectează-le folosind măsurători reale; piesele se adaptează proporțional.', ...(state.photo.descriptor.warnings || []).slice(0,2)].join(' '):state.model==='custom'?'Dimensiunile corpului. Compartimentele se adaptează proporțional; blatul se reglează separat mai jos.':'Dimensiunile corpului barului și ale mesei. Blaturile se reglează separat mai jos.';
      displayedSizeModel=state.model;
    }
    for(const key of Object.keys(fields)) {
      const input=$('size-'+key),limits=sizeLimit(state.model,key,size);
      input.min=limits.min;input.max=limits.max;input.title=fmt(limits.min)+'–'+fmt(limits.max)+' cm';
      if(document.activeElement!==input)input.value=size[key];
    }
    const c=state.sizes.custom,b=state.sizes.bar;
    document.querySelector('[data-model="custom"] small').textContent='Corp '+fmt(c.width)+' × '+fmt(c.depth)+' × '+fmt(c.height)+' cm';
    document.querySelector('[data-model="bar"] small').textContent='Corp '+fmt(b.width)+' × '+fmt(b.depth)+' × '+fmt(b.height)+' cm';
  }
  let selectedWorktop='cabinet',worktopModel=null;
  function syncWorktopControls() {
    $('worktopSettings').hidden=state.model==='photo';if(state.model==='photo')return;
    if(worktopModel!==state.model) {
      const keys=state.model==='custom'?['cabinet']:['bar','table'];
      if(!keys.includes(selectedWorktop))selectedWorktop=keys[0];
      $('worktopSelect').innerHTML=keys.map(key=>'<option value="'+key+'">'+({cabinet:'Blatul dulapului',bar:'Blatul barului',table:'Blatul mesei extensibile'}[key])+'</option>').join('');
      $('worktopSelect').value=selectedWorktop;worktopModel=state.model;
    }
    const top=resolvedWorktop(selectedWorktop),base=baseWorktop(selectedWorktop);
    for(const field of Object.keys(WORKTOP_LIMITS)) {
      const input=$('worktop-'+field);input.min=WORKTOP_LIMITS[field].min;input.max=WORKTOP_LIMITS[field].max;
      if(document.activeElement!==input)input.value=top[field];
    }
    $('worktop-note').textContent=selectedWorktop==='table'?'Blatul urmează extensia mesei; surplusul și deplasarea se păstrează. Pozițiile se citesc privind mobilierul din față.':'Dimensiunea se adaptează la corp, păstrând surplusul ales. Pozițiile se citesc privind mobilierul din față.';
    const referenceDepth=selectedWorktop==='bar'?state.sizes.bar.depth:base.depth;
    const excess={left:(top.width-base.width)/2-top.offsetX,right:(top.width-base.width)/2+top.offsetX,front:(top.depth-referenceDepth)/2+top.offsetZ,back:(top.depth-referenceDepth)/2-top.offsetZ};
    for(const [key,value]of Object.entries(excess))$('overhang-'+key).textContent=fmt(Math.round(value*10)/10)+' cm';
    $('overhang-label').textContent=selectedWorktop==='table'?'Față de conturul standard al mesei':'Depășire față de corp';
  }
  function extensionLength(){return 30+state.extension*(state.sizes.bar.tableLength-30);}
  function syncControls() {
    syncPhotoCard();
    document.querySelectorAll('[data-model]').forEach(button => { const active = button.dataset.model === state.model; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active); });
    document.querySelectorAll('[data-palette]').forEach(button => { const active = button.dataset.palette === state.palette; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active); });
    for (const role of ['top','fronts','body']) {
      $(role+'Color').value = state[role]; $(role+'Finish').value = state[role+'Finish'];
      // A queued model rebuild must not discard a HEX value that is still being typed.
      if(document.activeElement!==$(role+'Hex'))$(role+'Hex').value = state[role].toUpperCase();
    }
    $('paletteStatus').textContent = state.palette ? PRESETS[state.palette].name : 'Personalizată';
    $('doorsOpen').checked = state.doorsOpen; $('glass').checked = state.glass;
    $('doorsOpen').closest('.toggle-row').hidden=state.model==='photo';
    $('glassControl').hidden = state.model !== 'custom';
    $('extensionControl').hidden = state.model !== 'bar';
    $('extension').value = Math.round(state.extension*100);
    $('extensionValue').textContent = fmt(extensionLength())+' cm';
    $('dimensionsBtn').setAttribute('aria-pressed', state.dimensions);
    const info = MODELS[state.model];
    $('modelTitle').textContent = state.model==='photo'?state.photo.name:info.title; $('modelDescription').textContent = info.description;
    $('modelCategory').textContent = state.model==='photo'?'FOTOGRAFIA TA / MODEL APROXIMATIV':'COLECȚIA BUCĂTĂRIE / '+info.index;
    document.querySelector('.model-badge>span:last-child').textContent=state.model==='photo'?(state.photo.descriptor.version===2?'GENERAT CU AI · MODEL EDITABIL':'MODEL IMPORTAT DIN FOTOGRAFIE'):'MODEL 3D INTERACTIV';
    $('viewport').setAttribute('aria-label', info.title + '. Model 3D. Trage pentru rotire, derulează pentru zoom. Săgeți pentru rotire, plus și minus pentru zoom.');
    syncSizeControls();
    syncWorktopControls();
    syncShareLink();
  }
  function syncShareLink() {
    // Photo models remain shareable through exported project files.
    if (shareLinkMode === 'configuration' && state.model === 'photo') {
      shareLinkMode = null;
      const url = new URL(window.location.href); url.searchParams.delete(CONFIGURATION_PARAM);
      try { history.replaceState(history.state,'',url.href); } catch (_) {}
    }
    if (!shareLinkMode) return;
    const url = shareUrl();
    // An active share URL follows the edited configuration, including geometry and toggles.
    if (url !== window.location.href) {
      try { history.replaceState(history.state,'',url); }
      catch (_) { /* Some file viewers disallow changing history; the copyable link still works. */ }
    }
    if ($('shareAppearanceDialog').open && $('appearanceShareUrl').value !== url) {
      $('appearanceShareUrl').value = url;
      updateSharePreview();
      $('appearanceShareStatus').textContent = 'Link actualizat. Copiază-l pentru a partaja configurația curentă.';
    }
  }
  function updateSharePreview() {
    $('share-model-value').textContent = MODELS[state.model].title;
    $('share-size-value').textContent = fmt(metrics.width)+' × '+fmt(metrics.depth)+' × '+fmt(metrics.height)+' cm';
    const worktops = resolvedWorktops();
    $('share-worktops-value').textContent = (state.model==='custom' ? [['cabinet','Dulap']] : [['bar','Bar'],['table','Masă']]).map(([key,label])=>{
      const top=worktops[key];
      return label+': '+fmt(top.width)+' × '+fmt(top.depth)+' cm · X '+fmt(top.offsetX)+' / Z '+fmt(top.offsetZ)+' cm';
    }).join('\n');
    const details = ['Uși '+(state.doorsOpen?'deschise':'închise')];
    if(state.model==='custom')details.push('Fronturi '+(state.glass?'din sticlă':'pline'));
    if(state.model==='bar')details.push('Extensie '+fmt(extensionLength())+' cm');
    details.push('Cote '+(state.dimensions?'afișate':'ascunse'));
    $('share-details-value').textContent = details.join(' · ');
    for (const role of MATERIAL_ROLES) {
      $('share-'+role+'-chip').style.backgroundColor = state[role];
      $('share-'+role+'-value').textContent = state[role].toUpperCase()+' · '+FINISH_LABELS[state[role+'Finish']];
    }
  }
  async function copyConfigurationLink() {
    const field = $('appearanceShareUrl'), status = $('appearanceShareStatus');
    const url = shareUrl('configuration'); field.value = url;
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard indisponibil.');
      await navigator.clipboard.writeText(url);
      if ($('shareAppearanceDialog').open && field.value === url) status.textContent = 'Link copiat! Îl poți trimite sau păstra pentru mai târziu.';
    } catch (_) {
      if (!$('shareAppearanceDialog').open) return;
      field.focus(); field.select(); field.setSelectionRange(0,field.value.length);
      status.textContent = 'Copiază manual linkul selectat: Ctrl+C sau ține apăsat pe telefon.';
    }
  }
  function rebuild(resetCamera = false) {
    const refit=pendingRefit;pendingRebuild=false;pendingRefit=false;
    // Rebuild off-scene first so the previous object survives a failed update.
    const built = MODELS[state.model].builder({ ...state, size:state.sizes[state.model], worktops:resolvedWorktops(), hardware: '#4d5148', edgeDetails: true });
    dispose(model); model = built.group; model.name = state.model;
    metrics = { width: built.width, height: built.height, depth: built.depth };
    modelBounds=built.bounds||{minX:-built.width/2,maxX:built.width/2,minZ:-built.depth/2,maxZ:built.depth/2};
    scene.add(model); makeDimensions();
    $('sizeText').innerHTML = fmt(metrics.width)+' × '+fmt(metrics.depth)+' × '+fmt(metrics.height)+' <small>cm</small>';
    if (resetCamera || refit) fit(resetCamera);
    syncControls(); persist(); dirty = true;
  }
  function scheduleRebuild(refit=false) { pendingRebuild = true; pendingRefit=pendingRefit||refit; }
  function selectView(view) {
    document.querySelectorAll('[data-view]').forEach(button => { const active = view === button.dataset.view; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active); });
  }
  function resize() {
    const box = $('viewport').getBoundingClientRect();
    if (!box.width || !box.height) return;
    camera.aspect = box.width / box.height; camera.updateProjectionMatrix(); renderer.setSize(box.width, box.height, false); fit(false); dirty = true;
  }
  const pointers = new Map(); let pinch = 0;
  const viewport = $('viewport');
  viewport.addEventListener('pointerdown', event => { pointers.set(event.pointerId, {x:event.clientX,y:event.clientY}); viewport.setPointerCapture(event.pointerId); viewport.focus({preventScroll:true}); pinch=0; });
  viewport.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    const previous = pointers.get(event.pointerId); pointers.set(event.pointerId, {x:event.clientX,y:event.clientY});
    if (pointers.size === 1) { theta -= (event.clientX-previous.x)*0.008; phi = T.MathUtils.clamp(phi-(event.clientY-previous.y)*0.006, 0.2, Math.PI/2-0.015); selectView(null); }
    else { const points = [...pointers.values()], distance = Math.hypot(points[0].x-points[1].x, points[0].y-points[1].y); if (pinch>0 && distance>0) radius = T.MathUtils.clamp(radius*pinch/distance, fitRadius*.4, fitRadius*2.6); pinch=distance; }
    updateCamera();
  });
  for (const event of ['pointerup','pointercancel','lostpointercapture']) viewport.addEventListener(event, e => { pointers.delete(e.pointerId); pinch=0; });
  function zoom(factor) { radius = T.MathUtils.clamp(radius*factor,fitRadius*.4,fitRadius*2.6); updateCamera(); }
  viewport.addEventListener('wheel', event => { event.preventDefault(); zoom(Math.exp(Math.sign(event.deltaY)*0.08)); }, {passive:false});
  viewport.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','0','Home'].includes(event.key)) return;
    event.preventDefault();
    if(event.key==='ArrowLeft')theta-=.12; if(event.key==='ArrowRight')theta+=.12;
    if(event.key==='ArrowUp')phi=Math.max(.2,phi-.1); if(event.key==='ArrowDown')phi=Math.min(Math.PI/2-.015,phi+.1);
    if(event.key==='+'||event.key==='=')zoom(.9); if(event.key==='-')zoom(1.1);
    if(event.key==='0'||event.key==='Home')fit(true); else {selectView(null);updateCamera();}
  });
  document.querySelector('.model-grid').addEventListener('click',event=>{const button=event.target.closest('[data-model]');if(!button||state.model===button.dataset.model)return;const next=button.dataset.model;if(!Object.hasOwn(MODELS,next)||(next==='photo'&&!state.photo))return;state.model=next;state.doorsOpen=false;rebuild(true);});
  document.querySelectorAll('[data-palette]').forEach(button => button.addEventListener('click', () => { const key=button.dataset.palette; Object.assign(state, PRESETS[key], {palette:key}); syncControls(); scheduleRebuild(); }));
  for(const role of ['top','fronts','body']) {
    $(role+'Color').addEventListener('input', event => {state[role]=event.target.value;state.palette=matchedPalette(state);syncControls();scheduleRebuild();});
    $(role+'Hex').addEventListener('change', event => {
      let value=event.target.value.trim(); if(!value.startsWith('#'))value='#'+value;
      if(/^#[0-9a-f]{3}$/i.test(value))value='#'+[...value.slice(1)].map(c=>c+c).join('');
      if(!/^#[0-9a-f]{6}$/i.test(value)){event.target.value=state[role].toUpperCase();toast('Introdu un cod HEX valid, de exemplu #87927B.');return;}
      state[role]=value.toLowerCase();state.palette=matchedPalette(state);syncControls();scheduleRebuild();
    });
    $(role+'Finish').addEventListener('change', event => {state[role+'Finish']=event.target.value;state.palette=matchedPalette(state);syncControls();scheduleRebuild();});
  }
  function editSize(event) {
    const input=event.target,key=input.dataset.size;if(!key)return;
    if(input.value.trim()===''||!input.validity.valid||!Number.isFinite(input.valueAsNumber)) {
      if(event.type==='change') {const limits=sizeLimit(state.model,key,state.sizes[state.model]);input.value=state.sizes[state.model][key];toast('Introdu o valoare între '+fmt(limits.min)+' și '+fmt(limits.max)+' cm.');}
      return;
    }
    state.sizes[state.model]=normalizeSize(state.model,{...state.sizes[state.model],[key]:input.valueAsNumber});
    if(event.type==='change')input.value=state.sizes[state.model][key];
    syncSizeControls();scheduleRebuild(true);
  }
  $('dimensionSettings').addEventListener('input',editSize);
  $('dimensionSettings').addEventListener('change',editSize);
  function editWorktop(event) {
    const input=event.target,field=input.dataset.worktop;if(!field)return;
    if(input.value.trim()===''||!input.validity.valid||!Number.isFinite(input.valueAsNumber)) {
      if(event.type==='change'){input.value=resolvedWorktop(selectedWorktop)[field];const limits=WORKTOP_LIMITS[field];toast('Introdu o valoare între '+limits.min+' și '+limits.max+' cm.');}return;
    }
    const value=Math.round(input.valueAsNumber*10)/10,base=baseWorktop(selectedWorktop);
    if(field==='width'||field==='depth')state.worktops[selectedWorktop][field+'Delta']=Math.round((value-base[field])*10)/10;
    else state.worktops[selectedWorktop][field]=value;
    if(event.type==='change')input.value=value;
    syncWorktopControls();scheduleRebuild(true);
  }
  $('worktopSettings').addEventListener('input',editWorktop);$('worktopSettings').addEventListener('change',editWorktop);
  $('worktopSelect').addEventListener('change',event=>{selectedWorktop=event.target.value;syncWorktopControls();});
  $('centerWorktop').addEventListener('click',()=>{state.worktops[selectedWorktop].offsetX=0;state.worktops[selectedWorktop].offsetZ=0;pendingRefit=true;rebuild();});
  $('resetWorktop').addEventListener('click',()=>{state.worktops[selectedWorktop]=defaultWorktop();pendingRefit=true;rebuild();toast('Blatul selectat a revenit la dimensiunea și poziția inițiale.');});
  $('resetDimensions').addEventListener('click',()=>{state.sizes[state.model]=originalSize(state.model);resetModelWorktops();pendingRefit=true;rebuild();toast(state.model==='photo'?'Dimensiunile au revenit la valorile de la import.':'Dimensiunile modelului și blaturile au revenit la cele din schiță.');});
  $('extension').addEventListener('input', event => {state.extension=Number(event.target.value)/100; $('extensionValue').textContent=fmt(extensionLength())+' cm';scheduleRebuild();});
  $('extension').addEventListener('change', () => {if(pendingRebuild){pendingRebuild=false;rebuild();}fit(false);});
  for(const key of ['doorsOpen','glass'])$(key).addEventListener('change', event => {state[key]=event.target.checked;rebuild();if(key==='doorsOpen')fit(false);});
  $('dimensionsBtn').addEventListener('click', () => {state.dimensions=!state.dimensions;dimensions.visible=state.dimensions;syncControls();persist();dirty=true;});
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    const view=button.dataset.view;
    if(view==='perspective'){fit(true);return;}
    theta=view==='back'?Math.PI:view==='side'?Math.PI/2:0;phi=Math.PI/2-.004;selectView(view);fit(false);
  }));
  $('zoomIn').addEventListener('click', () => zoom(.86)); $('zoomOut').addEventListener('click', () => zoom(1.16)); $('fitBtn').addEventListener('click', () => fit(true));
  $('resetBtn').addEventListener('click', () => {const current=state.model,sizes=state.sizes,photo=state.photo,worktops=state.worktops;state=defaults();state.model=current;state.sizes=sizes;state.photo=photo;state.worktops=worktops;state.sizes[current]=originalSize(current);resetModelWorktops();rebuild(true);toast('Configurația modelului a fost resetată.');});
  function download(blob,name) { const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000); }
  $('saveBtn').addEventListener('click', () => {const project={format:'forma-furniture',version:4,savedAt:new Date().toISOString(),configuration:state};download(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}),'forma-'+state.model+'.json');toast('Proiect salvat. Îl poți redeschide în acest configurator.');});
  $('shareAppearanceBtn').addEventListener('click', () => {
    if(state.model==='photo') {
      toast('Pentru a partaja mobilierul din fotografie, folosește „Salvează proiect” și trimite fișierul JSON.');
      return;
    }
    // Flush debounced size edits before showing the measured dimensions in the summary.
    if(pendingRebuild)rebuild();
    shareLinkMode = 'configuration'; syncShareLink();
    $('appearanceShareUrl').value = shareUrl();
    $('appearanceShareStatus').textContent = 'Se copiază linkul…';
    $('appearanceLocalNote').hidden = window.location.protocol !== 'file:';
    updateSharePreview();
    $('shareAppearanceDialog').showModal();
    copyConfigurationLink();
  });
  $('copyAppearanceLink').addEventListener('click',copyConfigurationLink);
  $('appearanceShareUrl').addEventListener('click',event=>event.target.select());
  $('closeAppearanceShare').addEventListener('click',()=>$('shareAppearanceDialog').close());
  $('shareAppearanceDialog').addEventListener('click',event=>{
    if(event.target!==event.currentTarget)return;
    const rect=event.currentTarget.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.currentTarget.close();
  });
  $('importBtn').addEventListener('click', () => $('projectFile').click());
  $('projectFile').addEventListener('change', async event => {
    const file=event.target.files[0];if(!file)return;
    try {if(file.size>500000)throw new Error('Fișierul este prea mare pentru un proiect.');const data=JSON.parse(await file.text());if(data.format!=='forma-furniture'||![1,2,3,4].includes(data.version))throw new Error('Alege un proiect JSON salvat din FORMĂ.');state=validate(data.configuration);rebuild(true);toast('Proiectul a fost încărcat.');}
    catch(error){toast(error.message||'Proiectul nu a putut fi încărcat.');}
    event.target.value='';
  });
  $('pngBtn').addEventListener('click', () => {
    if(pendingRebuild){pendingRebuild=false;rebuild();}
    const previousSize=renderer.getSize(new T.Vector2()),previousRatio=renderer.getPixelRatio();
    const exportWidth=1600,exportHeight=Math.round(exportWidth/camera.aspect);
    renderer.setPixelRatio(1);renderer.setSize(exportWidth,exportHeight,false);
    renderer.render(scene,camera);
    const source=renderer.domElement, canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height+140;
    const dark=window.FormaTheme.getTheme()==='dark';
    const ctx=canvas.getContext('2d');ctx.fillStyle=dark?'#151d18':'#f4f4ee';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0);
    ctx.fillStyle=dark?'#e4eadf':'#3f5137';ctx.font='30px Georgia';ctx.fillText('FORMĂ / '+MODELS[state.model].title,32,source.height+47);
    ctx.font='17px Segoe UI';ctx.fillStyle=dark?'#a0ad9a':'#7d8973';ctx.fillText(fmt(metrics.width)+' × '+fmt(metrics.depth)+' × '+fmt(metrics.height)+' cm  ·  '+(state.palette?PRESETS[state.palette].name:'Paletă personalizată'),32,source.height+81);
    ctx.font='12px Segoe UI';ctx.fillText('Model orientativ după fotografii. Blat '+state.top+' · Fronturi '+state.fronts+' · Corp '+state.body,32,source.height+110);
    renderer.setPixelRatio(previousRatio);renderer.setSize(previousSize.x,previousSize.y,false);dirty=true;
    canvas.toBlob(blob=>{if(blob){download(blob,'forma-'+state.model+'.png');toast('Imaginea 3D a fost exportată.');}},'image/png');
  });
  $('fullscreenBtn').addEventListener('click', async () => {try{if(document.fullscreenElement)await document.exitFullscreen();else if($('stage').requestFullscreen)await $('stage').requestFullscreen();else toast('Ecranul complet nu este disponibil în acest browser.');}catch(_){toast('Ecranul complet nu este disponibil în acest browser.');}});
  $('trendsBtn').addEventListener('click', () => $('trendsDialog').showModal());
  $('trendsDialog').querySelector('.dialog-close').addEventListener('click', () => $('trendsDialog').close());
  $('trendsDialog').addEventListener('click', e => {if(e.target===$('trendsDialog')){const rect=e.target.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)e.target.close();}});
  document.querySelector('.brand').addEventListener('click', e=>{e.preventDefault();fit(true);});
  if(FEATURES.photoImport)window.FurniturePhotoUI.init({onGenerated:payload=>{
    const imported=validatePhoto({...payload,initialSize:payload.size});
    const previous=state;
    state={...state,model:'photo',photo:imported,sizes:{...state.sizes,photo:{...imported.initialSize}},doorsOpen:false,palette:null,...imported.descriptor.colors,bodyFinish:'matte',frontsFinish:'matte',topFinish:'matte'};
    try {rebuild(true);toast('Volumul 3D a fost creat. Poți schimba culorile și dimensiunile.');}
    catch(error){state=previous;throw error;}
  }});
  renderer.domElement.addEventListener('webglcontextlost', event=>{event.preventDefault();toast('Contextul grafic s-a întrerupt. Reîncarcă pagina pentru a restaura modelul.');});
  $('themeToggle').addEventListener('click',()=>window.FormaTheme.toggle());
  window.addEventListener('forma:themechange',syncTheme);
  syncTheme();
  new ResizeObserver(resize).observe(viewport);
  rebuild(true); resize(); $('loading').hidden=true;
  if(shareLoadMessage)toast(shareLoadMessage);
  function animate(){requestAnimationFrame(animate);if(pendingRebuild){pendingRebuild=false;rebuild();}if(dirty){renderer.render(scene,camera);dirty=false;}}
  animate();
  // Read-only inspection hook makes the generated dimensions and renderer verifiable.
  window.FormaConfigurator={getState:()=>JSON.parse(JSON.stringify(state)),getMetrics:()=>({...metrics}),getScene:()=>scene,getRenderer:()=>renderer};
})();
