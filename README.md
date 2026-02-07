SOLO LEVELING FITNESS TRACKER

A gamified fitness application inspired by Solo Leveling anime/manhwa. Track workouts, level up your character, and complete daily quests to become stronger.

FEATURES

- RPG-Style Progression System
  Level up by completing workouts and earn XP
  Hunter ranking based on your fitness level
  Penalty system for missed daily quests

- Daily Quest System
  Auto-generated quests based on your fitness goal
  Custom program scheduling for specific days
  Muscle building, weight loss, or speed/strength paths

- Pose Detection (Optional)
  Camera-based exercise tracking
  Real-time form monitoring for supported exercises
  Manual input option available

- Custom Program Builder
  Create personalized workout routines
  Add custom exercises with rep targets
  Schedule programs for specific weekdays
  Mix standard and custom exercises

- Music Player
  Background music playback during workouts
  Import custom tracks from device
  Multiple playback modes (loop all, play all, loop one, play one)
  Mini player overlay on all screens
  Built-in Solo Leveling soundtrack

- Progress Tracking
  Workout history with XP gains
  Visual charts showing performance trends
  Total dungeons cleared statistics
  Level and rank progression

- Profile Customization
  Upload profile photo
  Set fitness goals and stats
  Adjust system settings
  Enable/disable camera features

TECH STACK

- React Native with Expo
- TypeScript
- expo-camera for pose detection
- expo-av for background music
- react-native-chart-kit for statistics
- AsyncStorage for data persistence
- react-native-safe-area-context

INSTALLATION

1. Clone the repository
2. Install dependencies:
   npm install
3. Run the app:
   npx expo start

REQUIRED DEPENDENCIES

expo-camera
expo-av
expo-document-picker
expo-image-picker
@react-native-async-storage/async-storage
@react-native-community/slider
react-native-chart-kit
react-native-safe-area-context
@expo/vector-icons

USAGE

First Launch
- Create your hunter profile
- Set fitness goal (Muscle, Weight Loss, or Speed & Strength)
- Complete initial assessment test
- System calculates your starting level

Daily Quests
- Accept daily quest from dashboard
- Complete exercises with camera tracking or manual input
- Mark exercises complete or use "Complete All"
- Earn XP and level up

Custom Programs
- Navigate to Programs screen
- Create new program with custom exercises
- Schedule for specific weekdays
- Programs become daily quests on scheduled days

Music Player
- Add custom audio files
- Control playback from mini player
- Access full player for advanced controls
- Music continues in background during workouts

PENALTY SYSTEM

Missing daily quests results in XP loss:
- 100 XP penalty per missed day
- Can cause level decrease if XP goes negative
- Automatic check on app launch

EXERCISE TYPES

Standard Exercises:
- Squats, Push-ups, Sit-ups, Pull-ups
- Bicep Curls, Lunges, Plank
- Running (distance-based)

Dynamic Exercises:
- Clap Push-ups, Jump Squats, Burpees

Camera Support:
- Squats, Push-ups, Sit-ups, Bicep Curls
- Manual input for all exercises

SCREENS

- Dashboard: View stats, access features
- Quest: View and accept daily missions
- Training: Active workout session with timer
- Stats: Progress charts and history
- Music: Full music player controls
- Programs: Manage custom routines
- Settings: Profile and system configuration

FUTURE ENHANCEMENTS

- Advanced pose detection algorithms
- Social features and leaderboards
- Achievement system
- More exercise types
- Cloud backup
- Workout reminders


CREDITS

Inspired by Solo Leveling
Default soundtrack and system sounds included