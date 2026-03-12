self.addEventListener('install',event=>{
 event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate',event=>{
 event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const allClients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  if(allClients&&allClients.length){
   const client=allClients[0];
   if(client&&'focus' in client){
    await client.focus();
    return;
   }
  }
  if(self.clients.openWindow){
   await self.clients.openWindow('coins.html');
  }
 })());
});
