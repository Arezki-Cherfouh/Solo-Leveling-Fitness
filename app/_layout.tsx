// import { Stack } from "expo-router";

// export default function RootLayout() {
//   return <Stack />;
// }

// import { Stack } from "expo-router";

// export default function RootLayout() {
//   return (
//     <Stack screenOptions={{ headerShown: false, contentStyle: { paddingBottom: 0 } }} />
//   );
// }

import { Stack } from "expo-router";
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" backgroundColor="#050714" />
      <Stack 
        screenOptions={{ 
          headerShown: false,
          contentStyle: { 
            backgroundColor: '#050714',
          } 
        }} 
      />
    </>
  );
}