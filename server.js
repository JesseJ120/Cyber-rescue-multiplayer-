const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const roles = [
  { name: 'Network Defender', icon: '🛡️', color: '#22d3ee', ability: 'Firewall pulse lowers threat.' },
  { name: 'Security Specialist', icon: '🔐', color: '#34d399', ability: 'Scan disables a hacker.' },
  { name: 'AI Specialist', icon: '🤖', color: '#c084fc', ability: 'Predictive analysis boosts progress.' },
  { name: 'System Administrator', icon: '🛠️', color: '#fbbf24', ability: 'Emergency repair gives a large boost.' }
];
const rooms = new Map();
const obstacles = [
  { x: 185, y: 185, w: 105, h: 70 }, { x: 510, y: 170, w: 110, h: 80 },
  { x: 245, y: 355, w: 120, h: 62 }, { x: 465, y: 345, w: 120, h: 60 }
];

app.use(express.static(path.join(__dirname, 'public')));
function newRoomCode() { let code; do code = Math.random().toString(36).slice(2, 6).toUpperCase(); while (rooms.has(code)); return code; }
function makeMission() { return { progress: 0, timer: 300, active: false, phase: 'Lobby', threat: 0, repaired: 0, wave: 0, score: 0, message: 'Waiting for team' }; }
function ensureRoom(code) { if (!rooms.has(code)) rooms.set(code, { code, players: new Map(), mission: makeMission(), powerups: [], enemies: [], nextEnemyId: 1 }); return rooms.get(code); }
function getRoom(code) { return rooms.get(code); }
function distance(a,b) { return Math.hypot(a.x-b.x, a.y-b.y); }
function snapshot(room) { return { room: room.code, players: [...room.players.values()], mission: room.mission, powerups: room.powerups, enemies: room.enemies, obstacles, maxPlayers: 8 }; }
function broadcast(room) { io.to(room.code).emit('state', snapshot(room)); }
function spawnPowerup(room) { if (room.powerups.length >= 4) return; const types=['shield','boost','repair','freeze']; room.powerups.push({id:Math.random().toString(36).slice(2),type:types[Math.floor(Math.random()*types.length)],x:90+Math.random()*560,y:125+Math.random()*330}); }
function spawnWave(room) { room.mission.wave += 1; const count = Math.min(2 + room.mission.wave, 7); for(let i=0;i<count;i++){ const edge=Math.floor(Math.random()*4); let x,y; if(edge===0){x=55;y=115+Math.random()*350} else if(edge===1){x=650;y=115+Math.random()*350} else if(edge===2){x=70+Math.random()*560;y=105} else {x=70+Math.random()*560;y=475} room.enemies.push({id:'h'+room.nextEnemyId++,x,y,hp:100,speed:0.8+Math.random()*0.35,disabled:0}); } room.mission.threat=Math.min(100,room.mission.threat+7); room.mission.message=`Hacker wave ${room.mission.wave} detected!`; }
function resetPlayers(room){ for(const p of room.players.values()){p.score=0;p.shield=false;p.boost=false;p.cooldown=0;p.x=90+Math.random()*560;p.y=125+Math.random()*330;} }
function endMission(room,phase,message){room.mission.active=false;room.mission.phase=phase;room.mission.message=message;broadcast(room);}

io.on('connection', socket => {
  socket.emit('welcome', { rooms:[...rooms.keys()] });
  socket.on('joinRoom', ({code,name,role})=>{
    code=String(code||'').trim().toUpperCase().slice(0,6); if(!/^[A-Z0-9]{4,6}$/.test(code)) code=newRoomCode();
    const room=ensureRoom(code); if(room.players.size>=8) return socket.emit('errorMessage','That room is full.');
    if(socket.data.room){const old=getRoom(socket.data.room);if(old){old.players.delete(socket.id);if(!old.players.size)rooms.delete(old.code);else broadcast(old);}}
    socket.join(code); socket.data.room=code;
    const roleIndex=Number.isInteger(role)?Math.max(0,Math.min(3,role)):room.players.size%4;
    room.players.set(socket.id,{id:socket.id,name:String(name||`Player ${room.players.size+1}`).slice(0,18),role:roleIndex,x:90+Math.random()*560,y:125+Math.random()*330,score:0,ready:false,shield:false,boost:false,cooldown:0,onlineAt:Date.now()});
    socket.emit('joined',{code}); broadcast(room);
  });
  socket.on('update',data=>{const room=getRoom(socket.data.room),p=room?.players.get(socket.id);if(!p||!data)return;if(Number.isFinite(data.x))p.x=Math.max(35,Math.min(680,data.x));if(Number.isFinite(data.y))p.y=Math.max(100,Math.min(485,data.y));if(typeof data.name==='string')p.name=data.name.slice(0,18)||p.name;if(Number.isInteger(data.role)&&data.role>=0&&data.role<4)p.role=data.role;if(typeof data.ready==='boolean')p.ready=data.ready;broadcast(room);});
  socket.on('startGame',()=>{const room=getRoom(socket.data.room);if(!room)return;const ps=[...room.players.values()];if(!ps.length||ps.some(p=>!p.ready))return socket.emit('errorMessage','Everyone in the room must be Ready.');room.mission={progress:0,timer:300,active:true,phase:'Secure the Main Server',threat:10,repaired:0,wave:0,score:0,message:'Secure the server and stop the hacker waves.'};room.powerups=[];room.enemies=[];room.nextEnemyId=1;resetPlayers(room);spawnWave(room);broadcast(room);});
  socket.on('repair',()=>{const room=getRoom(socket.data.room),p=room?.players.get(socket.id);if(!room||!p||!room.mission.active||p.cooldown>0)return;let bonus=p.role===3?10:p.role===2?6:4;room.mission.progress=Math.min(100,room.mission.progress+bonus);room.mission.repaired++;p.score+=100+bonus*10;p.cooldown=2;if(room.mission.progress>=100)endMission(room,'CITY SAVED','🏆 City saved! Your team defeated the cyberattack.');else broadcast(room);});
  socket.on('ability',()=>{const room=getRoom(socket.data.room),p=room?.players.get(socket.id);if(!room||!p||!room.mission.active||p.cooldown>0)return;p.cooldown=5;if(p.role===0){room.mission.threat=Math.max(0,room.mission.threat-22);room.mission.message='Firewall pulse blocked an attack!';p.score+=100;}else if(p.role===1){const target=room.enemies.sort((a,b)=>distance(a,p)-distance(b,p))[0];if(target&&distance(target,p)<210){target.disabled=6;p.score+=125;room.mission.message='Security scan disabled a hacker!';}else room.mission.message='Security scan found no nearby hacker.';}else if(p.role===2){room.mission.progress=Math.min(100,room.mission.progress+8);room.mission.threat=Math.max(0,room.mission.threat-8);p.score+=140;room.mission.message='AI prediction stabilized the network!';}else{room.mission.progress=Math.min(100,room.mission.progress+12);p.score+=175;room.mission.message='Emergency repair completed!';}if(room.mission.progress>=100)endMission(room,'CITY SAVED','🏆 City saved! Your team defeated the cyberattack.');else broadcast(room);});
  socket.on('collectPowerup',({id})=>{const room=getRoom(socket.data.room),p=room?.players.get(socket.id);if(!room||!p)return;const item=room.powerups.find(x=>x.id===id);if(!item)return;room.powerups=room.powerups.filter(x=>x.id!==id);if(item.type==='shield')p.shield=true;if(item.type==='boost')p.boost=true;if(item.type==='repair'){room.mission.progress=Math.min(100,room.mission.progress+12);p.score+=200;}if(item.type==='freeze'){room.enemies.forEach(e=>e.disabled=5);p.score+=150;}broadcast(room);});
  socket.on('disconnect',()=>{const room=getRoom(socket.data.room);if(!room)return;room.players.delete(socket.id);if(!room.players.size)rooms.delete(room.code);else broadcast(room);});
});

setInterval(()=>{
  for(const room of rooms.values()){
    for(const p of room.players.values()) p.cooldown=Math.max(0,p.cooldown-1);
    if(!room.mission.active) { broadcast(room); continue; }
    room.mission.timer-=1;
    if(Math.random()<0.12) spawnPowerup(room);
    if(Math.random()<0.22) room.mission.threat=Math.min(100,room.mission.threat+2);
    if(room.mission.timer%35===0) spawnWave(room);
    for(const e of room.enemies){
      if(e.disabled>0){e.disabled-=1;continue;}
      const targets=[...room.players.values()].filter(p=>!p.shield); if(!targets.length)continue;
      const t=targets.reduce((a,b)=>distance(a,e)<distance(b,e)?a:b); const d=distance(t,e);
      if(d>28){e.x+=(t.x-e.x)/Math.max(d,1)*e.speed*3;e.y+=(t.y-e.y)/Math.max(d,1)*e.speed*3;}
      else {room.mission.threat=Math.min(100,room.mission.threat+1);}
    }
    room.enemies=room.enemies.filter(e=>e.x>15&&e.x<700&&e.y>80&&e.y<510);
    if(room.mission.threat>=100||room.mission.timer<=0) endMission(room,'SYSTEM OVERRUN','☠ System overrun. The hackers won this round.');
    else broadcast(room);
  }
},1000);

server.listen(PORT,()=>console.log(`Cyber Rescue running on http://localhost:${PORT}`));
