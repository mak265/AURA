export const pageImports={
 Welcome:()=>import('./pages/Welcome'),Login:()=>import('./pages/Login'),Signup:()=>import('./pages/Signup'),Onboarding:()=>import('./pages/Onboarding'),Discover:()=>import('./pages/Discover'),Matches:()=>import('./pages/Matches'),Chat:()=>import('./pages/Chat'),AuraChat:()=>import('./pages/AuraChat'),Profile:()=>import('./pages/Profile'),ConnectionProfile:()=>import('./pages/ConnectionProfile'),Feed:()=>import('./pages/Feed'),Settings:()=>import('./pages/Settings'),
};
const navigation={'/feed':'Feed','/discover':'Discover','/aura-chat':'AuraChat','/matches':'Matches','/profile':'Profile'};
export function preloadPage(path){const name=navigation[path];if(name)pageImports[name]().catch(()=>{});}
