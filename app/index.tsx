// import { Text, View } from "react-native";

// export default function Index() {
//   return (
//     <View
//       style={{
//         flex: 1,
//         justifyContent: "center",
//         alignItems: "center",
//       }}
//     >
//       <Text>Edit app/index.tsx to edit this screen.</Text>
//     </View>
//   );
// }

import React from 'react';
import SoloLevelingFitnessTracker from './SoloLevelingFitnessTracker';

export default function Index() {
  return <SoloLevelingFitnessTracker />;
}

// import React from 'react';
// import { createStackNavigator } from '@react-navigation/stack';
// import SoloLevelingFitnessTracker from './SoloLevelingFitnessTracker';

// const Stack = createStackNavigator();

// export default function App() {
//   return (
//     <Stack.Navigator screenOptions={{ headerShown: false }}>
//       <Stack.Screen 
//         name="FitnessTracker" 
//         component={SoloLevelingFitnessTracker} 
//       />
//     </Stack.Navigator>
//   );
// }
