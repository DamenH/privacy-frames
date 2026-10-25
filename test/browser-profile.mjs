// Playwright deliberately relaxes storage privacy. Restore those browser
// protections for confinement tests instead of treating automation defaults as
// evidence that embedded and top-level state necessarily share a partition.
let chromiumDisabled;
async function options(engine,extra={}){
 if(engine.name()==='firefox')return {...extra,firefoxUserPrefs:{
  'browser.contentblocking.features.standard':'-tp,tpPrivate,cookieBehavior5,-cm,-fp',
  'network.cookie.cookieBehavior':5,'network.cookie.cookieBehavior.pbmode':5,
  'privacy.partition.network_state':true,...extra.firefoxUserPrefs,
 }};
 if(engine.name()!=='chromium')return extra;
 if(!chromiumDisabled){
  const probe=await engine.launch({executablePath:engine.executablePath(),args:['--enable-automation']});try{
   const session=await probe.newBrowserCDPSession();const {arguments:args}=await session.send('Browser.getBrowserCommandLine');
   chromiumDisabled=args.find(value=>value.startsWith('--disable-features='));
  }finally{await probe.close();}
 }
 const parts=chromiumDisabled.slice('--disable-features='.length).split(',').filter(name=>name!=='ThirdPartyStoragePartitioning');
 return {...extra,ignoreDefaultArgs:[...(extra.ignoreDefaultArgs||[]),chromiumDisabled],args:[...(extra.args||[]),'--disable-features='+parts.join(',')]};
}
export async function launch(engine,extra={}){return engine.launch(await options(engine,extra));}
export async function launchPersistent(engine,directory,extra={}){return engine.launchPersistentContext(directory,await options(engine,extra));}
