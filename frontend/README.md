# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
## Native message notifications

Enable push in **Settings → Notifications** on the installed app. The app registers the device after permission is granted. Alert text stays generic, and a tap opens the conversation.

- **Android:** Register `com.aura.dating.test` in Firebase for the debug APK and `com.aura.dating` for release. Put the Firebase app configuration at `android/app/google-services.json` before building. Configure `FCM_PROJECT_ID` and server-side Google Application Default Credentials with permission to send FCM messages.
- **iOS:** On macOS, build the `ios/App/App.xcodeproj` project with Xcode. Use an Apple development team and provisioning profile with Push Notifications enabled for the bundle ID. Set the server's `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_KEY_PATH`, `APNS_BUNDLE_ID`, and `APNS_ENV` to match the signed build. The private APNs key stays on the server.

Set `VITE_API_URL` to the reachable HTTPS API before syncing production native builds. See `backend/.env.example` for the server settings.
