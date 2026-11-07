import { useEffect, useState } from 'react';
const defaults={wallpaper:'lavender',largeText:false,enterToSend:true,badges:true,autoMedia:true};
function key(){try{const payload=JSON.parse(atob(localStorage.getItem('aura_token').split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));return 'aura_device_settings_'+payload.userId;}catch{return 'aura_device_settings_guest';}}
export function getDeviceSettings(){try{return {...defaults,...JSON.parse(localStorage.getItem(key())||'{}')};}catch{return defaults;}}
export function useDeviceSettings(){const [settings,setSettings]=useState(getDeviceSettings);useEffect(()=>{const update=()=>setSettings(getDeviceSettings());window.addEventListener('aura:settings',update);return()=>window.removeEventListener('aura:settings',update);},[]);return [settings,patch=>{const next={...getDeviceSettings(),...patch};localStorage.setItem(key(),JSON.stringify(next));setSettings(next);window.dispatchEvent(new Event('aura:settings'));}];}
