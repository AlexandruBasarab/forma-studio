const {chromium}=require('playwright');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const dir=path.join(__dirname,'qa');
(async()=>{
  if (/photoImport\s*:\s*false/.test(fs.readFileSync(path.join(__dirname,'configurator-mobilier.html'),'utf8'))) {
    console.log('Skipped photo-generation QA: photo import is currently disabled.');
    return;
  }
  fs.mkdirSync(dir,{recursive:true});
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || undefined,headless:true,args:['--allow-file-access-from-files','--enable-unsafe-swiftshader']});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
    await context.setOffline(true);
    const page=await context.newPage(),errors=[],network=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
    await page.goto(pathToFileURL(path.join(__dirname,'configurator-mobilier.html')).href);
    await page.waitForFunction(()=>window.FormaConfigurator);
    const images=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=600;c.height=500;const ctx=c.getContext('2d');
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,600,500);const blank=c.toDataURL('image/png');
      ctx.fillStyle='#b88952';ctx.fillRect(80,100,440,34);
      ctx.fillStyle='#556b52';ctx.fillRect(100,134,30,300);ctx.fillRect(470,134,30,300);
      ctx.fillStyle='#667956';ctx.fillRect(130,140,340,38);
      const table=c.toDataURL('image/png');
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,600,500);ctx.fillStyle='#ad8156';ctx.fillRect(120,45,360,25);
      ctx.fillStyle='#647a57';ctx.fillRect(130,70,340,370);ctx.fillStyle='#253820';ctx.fillRect(297,75,6,355);ctx.fillRect(137,210,326,5);
      return {blank,table,cabinet:c.toDataURL('image/png')};
    });
    for(const [name,url]of Object.entries(images))fs.writeFileSync(path.join(dir,'photo-'+name+'.png'),Buffer.from(url.split(',')[1],'base64'));
    const state=()=>page.evaluate(()=>FormaConfigurator.getState());
    const pauseFrame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await page.click('#photoUploadBtn');
    assert(await page.locator('#photoDialog').isVisible());
    await page.setInputFiles('#photoFile',path.join(dir,'photo-blank.png'));
    await page.waitForFunction(()=>!document.querySelector('#photoGenerate').disabled);
    await page.click('#photoGenerate');
    await page.waitForFunction(()=>document.querySelector('#photoStatus').textContent.length>10&&!document.querySelector('#photoGenerate').disabled);
    assert.equal((await state()).model,'custom','Failed conversion leaves original scene');
    await page.setInputFiles('#photoFile',path.join(dir,'photo-table.png'));
    await page.waitForFunction(()=>!document.querySelector('#photoGenerate').disabled);
    await page.click('#photoGenerate');
    await page.waitForFunction(()=>{const e=document.querySelector('#photoUse');return e&&!e.disabled;});
    await page.locator('#photoTolerance').evaluate(el=>{el.value='40';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert(await page.locator('#photoUse').isDisabled(),'Tolerance change invalidates previous result');
    await page.click('#photoGenerate');await page.waitForFunction(()=>!document.querySelector('#photoUse').disabled);
    await page.click('#photoImageTab');
    const preview=await page.locator('#photoPreview').boundingBox();
    await page.mouse.move(preview.x+preview.width*.15,preview.y+preview.height*.1);await page.mouse.down();
    await page.mouse.move(preview.x+preview.width*.85,preview.y+preview.height*.94,{steps:5});await page.mouse.up();
    assert(await page.locator('#photoUse').isDisabled(),'Crop invalidates previous result');
    assert(await page.locator('#photoClearCrop').isEnabled());
    await page.click('#photoGenerate');await page.waitForFunction(()=>!document.querySelector('#photoUse').disabled);
    await page.fill('#photoWidth','160');await page.fill('#photoHeight','80');await page.fill('#photoDepth','60');
    await page.screenshot({path:path.join(dir,'photo-review-desktop.png')});
    await page.click('#photoUse');await page.waitForFunction(()=>FormaConfigurator.getState().model==='photo');
    await pauseFrame();
    let s=await state();assert.equal(s.photo.descriptor.version,1);assert(s.photo.descriptor.grid.mask.some(n=>n===0));assert(s.photo.descriptor.grid.mask.some(n=>n===1));
    assert.deepEqual(await page.evaluate(()=>FormaConfigurator.getMetrics()),{width:160,height:80,depth:60});
    const info=await page.evaluate(()=>{
      const g=FormaConfigurator.getScene().getObjectByName('photo');g.updateMatrixWorld(true);const size=new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
      const ray=new THREE.Raycaster(new THREE.Vector3(0,15,500),new THREE.Vector3(0,0,-1));
      return {size:size.toArray(),meshCount:g.children.length,roles:g.children.map(x=>x.userData.role),holeHits:ray.intersectObject(g,true).length};
    });
    assert.deepEqual(info.size,[160,80,60]);assert.equal(info.meshCount,3);assert.deepEqual(info.roles,['body','fronts','top']);assert.equal(info.holeHits,0,'Leg opening remains a real opening');
    assert(await page.locator('#doorsOpen').isHidden());
    assert(await page.locator('#size-details').isHidden());
    await page.click('[data-palette="sage"]');await pauseFrame();
    for(const [role,value]of [['top','#d28632'],['fronts','#354f76'],['body','#748d5c']]){
      await page.fill('#'+role+'Hex',value);await page.locator('#'+role+'Hex').press('Tab');await pauseFrame();
      assert.equal(await page.evaluate(r=>FormaConfigurator.getScene().getObjectByName('photo-'+r).material.color.getHexString(),role),value.slice(1));
    }
    await page.fill('#size-width','190');await page.locator('#size-width').press('Tab');await pauseFrame();
    assert.equal((await page.evaluate(()=>FormaConfigurator.getMetrics())).width,190);
    await page.screenshot({path:path.join(dir,'photo-model-desktop.png')});
    const downloadPromise=page.waitForEvent('download');await page.click('#saveBtn');const download=await downloadPromise;
    const project=path.join(dir,'photo-project.json');await download.saveAs(project);const saved=JSON.parse(fs.readFileSync(project));assert.equal(saved.version,4);assert(saved.configuration.photo.thumbnail.startsWith('data:image/'));
    await page.click('[data-model="bar"]');assert(await page.locator('#photoModelCard').isVisible());
    await page.setInputFiles('#projectFile',project);await page.waitForFunction(()=>FormaConfigurator.getState().model==='photo');assert.equal((await state()).sizes.photo.width,190);
    await page.reload();await page.waitForFunction(()=>window.FormaConfigurator);assert.equal((await state()).model,'photo');assert.equal((await state()).sizes.photo.width,190);
    await page.click('#resetDimensions');await pauseFrame();assert.equal((await state()).sizes.photo.width,160);
    const before=await state();const bad={...saved,configuration:{...saved.configuration,photo:{...saved.configuration.photo,descriptor:{...saved.configuration.photo.descriptor,grid:{width:100000,height:100000,mask:[1]}}}}};
    await page.setInputFiles('#projectFile',{name:'bad-photo.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});await pauseFrame();assert.deepEqual(await state(),before,'Invalid project cannot replace current state');
    await page.setViewportSize({width:414,height:896});await page.screenshot({path:path.join(dir,'photo-model-mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.click('#photoUploadBtn');await page.setInputFiles('#photoFile',path.join(dir,'photo-cabinet.png'));await page.waitForFunction(()=>!document.querySelector('#photoGenerate').disabled);await page.click('#photoGenerate');await page.waitForFunction(()=>!document.querySelector('#photoUse').disabled);
    await page.screenshot({path:path.join(dir,'photo-review-mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
    console.log(JSON.stringify({passed:true,offline:true,realImageDerivedVolume:true,preservedHoles:true,threeMaterialRoles:true,dimensions:true,blankRejected:true,cropAndTolerance:true,projectRoundTrip:true,malformedProjectRejected:true,persistence:true,mobile:true,errors},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
