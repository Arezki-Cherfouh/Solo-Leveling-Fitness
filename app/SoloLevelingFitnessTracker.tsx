import { FontAwesome5, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  Image,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

const { width, height } = Dimensions.get('window');

// --- Type Definitions ---
type GoalType = 'muscle' | 'weight_loss' | 'speed_strength';

interface UserData {
  name: string;
  level: number;
  sex: 'male' | 'female';
  weight: number;
  height: number;
  goal: GoalType; 
  xp: number;
  totalWorkouts: number;
  createdAt: string;
  lastDailyQuestCompleted?: string; // ISO Date only YYYY-MM-DD
  cameraEnabled: boolean;
  profileImage?: string;
  assessmentStats?: { [key: string]: number };
}

interface Exercise {
  name: string;
  iconName: string;
  iconLib: 'Ionicons' | 'MaterialCommunityIcons' | 'FontAwesome5';
  type?: 'reps' | 'duration' | 'distance';
  custom?: boolean;
}

interface ExerciseConfig {
  [key: string]: Exercise;
}

interface Quest {
  title: string;
  difficulty: number;
  exercises: { [key: string]: number };
  rewards: {
    xp: number;
    title: string;
  };
  customExercises?: ExerciseConfig;
  isDaily?: boolean; // To track if this is the daily requirement
}

interface TrainingResult {
  [key: string]: number;
}

interface TrainingHistory {
  date: string;
  quest: Quest;
  results: TrainingResult;
  xpGained: number;
  durationSeconds?: number;
}

interface MusicTrack {
  id: string;
  title: string;
  path: any; // require() or uri string
  isLocal: boolean;
  isFavorite: boolean;
  artwork?: string;
}

interface CustomProgram {
  id: string;
  name: string;
  exercises: { [key: string]: number };
  customExercises?: ExerciseConfig;
  schedule: string[]; // ['Mon', 'Wed', etc.]
  createdAt: string;
}

interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface CustomAlertState {
  visible: boolean;
  title: string;
  message: string;
  buttons: AlertButton[];
}

type PlaybackMode = 'loop_all' | 'play_all' | 'loop_one' | 'play_one';

// --- Theme ---
const COLORS = {
  primary: '#050714',     
  secondary: '#0F172A',   
  accent: '#1E293B',      
  highlight: '#2563EB',   
  blue: '#3B82F6',        
  lightBlue: '#60A5FA',
  purple: '#7C3AED',      
  danger: '#EF4444',
  success: '#10B981',
  text: '#F8FAFC',
  textDark: '#94A3B8',
  glow: '#0EA5E9',
  gold: '#F59E0B',
  white: '#FFFFFF',
};

// --- Constants ---
const XP_PER_LEVEL_BASE = 600; 
const PENALTY_XP = 100;
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const EXERCISES: ExerciseConfig = {
  // Standard
  squats: { name: 'Squats', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
  pushups: { name: 'Push-ups', iconName: 'human-handsup', iconLib: 'MaterialCommunityIcons', type: 'reps' },
  situps: { name: 'Sit-ups', iconName: 'dumbbell', iconLib: 'FontAwesome5', type: 'reps' },
  pullups: { name: 'Pull-ups', iconName: 'human-male-height', iconLib: 'MaterialCommunityIcons', type: 'reps' },
  bicepCurls: { name: 'Bicep Curls', iconName: 'arm-flex', iconLib: 'MaterialCommunityIcons', type: 'reps' },
  lunges: { name: 'Lunges', iconName: 'run', iconLib: 'MaterialCommunityIcons', type: 'reps' },
  plank: { name: 'Plank (sec)', iconName: 'timer', iconLib: 'Ionicons', type: 'duration' },
  running: { name: 'Running (km)', iconName: 'run-fast', iconLib: 'MaterialCommunityIcons', type: 'distance' },
  
  // Dynamic / Speed & Strength
  clapPushups: { name: 'Clap Push-ups', iconName: 'flash', iconLib: 'MaterialCommunityIcons', type: 'reps' },
  jumpSquats: { name: 'Jump Squats', iconName: 'arrow-up-bold-circle', iconLib: 'MaterialCommunityIcons', type: 'reps' },
  burpees: { name: 'Burpees', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
};

// --- Pose Detection Logic ---
class PoseCalculator {
  static calculateAngle(a: {x:number, y:number}, b: {x:number, y:number}, c: {x:number, y:number}) {
    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180.0) angle = 360 - angle;
    return angle;
  }

  static detectSquat(landmarks: any): { angle: number } {
    return { angle: 0 }; 
  }

  static isSupported(exerciseKey: string): boolean {
      const supported = ['squats', 'pushups', 'situps', 'bicepCurls', 'lifting'];
      return supported.includes(exerciseKey);
  }
}

// --- Sound System ---
const SYSTEM_SOUND = require('../assets/audio/solo_leveling_system.mp3'); 
const DEFAULT_OST = require('../assets/audio/ost.mp3');

// --- Helper Functions ---
const getDayString = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'short' });
const getISODate = (date: Date) => date.toISOString().split('T')[0];

// --- Helper Components ---
const SoloIcon = ({ name, lib, size = 24, color = COLORS.text }: { name: string, lib: string, size?: number, color?: string }) => {
  if (lib === 'Ionicons') return <Ionicons name={name as any} size={size} color={color} />;
  if (lib === 'MaterialCommunityIcons') return <MaterialCommunityIcons name={name as any} size={size} color={color} />;
  if (lib === 'FontAwesome5') return <FontAwesome5 name={name as any} size={size} color={color} />;
  return null;
};

const CustomAlert = ({ visible, title, message, buttons, onClose }: { visible: boolean, title: string, message: string, buttons: AlertButton[], onClose: () => void }) => {
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.alertBox}>
          <Text style={styles.alertTitle}>{title}</Text>
          <View style={styles.divider} />
          <Text style={styles.alertMessage}>{message}</Text>
          <View style={styles.alertButtons}>
            {buttons.map((btn, index) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.alertButton,
                  btn.style === 'destructive' ? styles.alertButtonDestructive : 
                  btn.style === 'cancel' ? styles.alertButtonCancel : styles.alertButtonDefault
                ]}
                onPress={() => {
                  if (btn.onPress) btn.onPress();
                  onClose();
                }}
              >
                <Text style={styles.alertButtonText}>{btn.text}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
};

// --- Main App ---
export default function SoloLevelingFitnessTracker(): JSX.Element {
  // Global State
  const [screen, setScreenState] = useState<string>('loading');
  const [userData, setUserData] = useState<UserData | null>(null);
  const [customPrograms, setCustomPrograms] = useState<CustomProgram[]>([]);
  
  // Alert State
  const [alertState, setAlertState] = useState<CustomAlertState>({
    visible: false, title: '', message: '', buttons: [],
  });

  // Music Player State
  const [playlist, setPlaylist] = useState<MusicTrack[]>([]);
  const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null); 
  const [isPlaying, setIsPlaying] = useState(false);
  const [musicLoading, setMusicLoading] = useState(false); 
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('loop_all');
  
  // Refs for logic to avoid stale closures
  const playlistRef = useRef<MusicTrack[]>([]);
  const currentTrackRef = useRef<MusicTrack | null>(null);
  const playbackModeRef = useRef<PlaybackMode>('loop_all');

  useEffect(() => { playlistRef.current = playlist; }, [playlist]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { playbackModeRef.current = playbackMode; }, [playbackMode]);

  // System Sound State
  const [systemSoundObj, setSystemSoundObj] = useState<Audio.Sound | null>(null);

  // Training State
  const [currentQuest, setCurrentQuest] = useState<Quest | null>(null);
  const [isTraining, setIsTraining] = useState<boolean>(false);

  // --- Audio System Logic ---

  const playSystemSound = async () => {
    try {
      if (systemSoundObj) {
        await systemSoundObj.unloadAsync();
      }
      // Ducking music volume manually if needed
      if (sound && isPlaying) {
        await sound.setVolumeAsync(0.1); 
      }

      const { sound: newSysSound } = await Audio.Sound.createAsync(SYSTEM_SOUND);
      setSystemSoundObj(newSysSound);
      await newSysSound.playAsync();

      newSysSound.setOnPlaybackStatusUpdate(async (status) => {
        if (status.isLoaded && status.didJustFinish) {
            await newSysSound.unloadAsync();
            setSystemSoundObj(null);
            // Restore music volume
            if (sound && isPlaying) await sound.setVolumeAsync(1.0);
        }
      });
    } catch (error) { console.log('System sound error', error); }
  };

  const navigateTo = (newScreen: string) => {
    if (newScreen !== screen) {
      playSystemSound();
      setScreenState(newScreen);
    }
  };

  const showAlert = (title: string, message: string, buttons: AlertButton[] = [{ text: 'OK' }]) => {
    setAlertState({ visible: true, title, message, buttons });
  };

  const closeAlert = () => {
    setAlertState(prev => ({ ...prev, visible: false }));
  };

  // --- Hardware Back Button Handler ---
  useEffect(() => {
    const backAction = () => {
      // 1. Stop system sound if it's interfering
      if (systemSoundObj) {
        try {
            systemSoundObj.stopAsync();
            systemSoundObj.unloadAsync();
            setSystemSoundObj(null);
        } catch (e) {
            console.log("Error stopping system sound on back press", e);
        }
      }

      // If we are on main screens, let default exit behavior happen
      if (screen === 'dashboard' || screen === 'loading' || screen === 'setup') {
        return false;
      }
      
      // If in training, show confirmation alert instead of just going back
      if (screen === 'training') {
        showAlert("Abort Mission?", "Stop training?", [
          { text: "Cancel", style: "cancel" }, 
          { text: "Quit", style: "destructive", onPress: () => navigateTo('dashboard') }
        ]);
        return true; // Prevent default behavior
      }

      // For all other screens, navigate back to dashboard
      navigateTo('dashboard');
      return true; // Prevent default behavior
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction
    );

    return () => backHandler.remove();
  }, [screen, systemSoundObj]); // Added systemSoundObj dependency so closure captures it

  // --- Initialization & Penalty System ---
  useEffect(() => {
    async function init() {
      // 1. Configure Background Audio 
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: true, 
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      } catch (e) {
        console.warn("Audio Mode Config Error:", e);
      }

      // Load Music
      try {
        const stored = await AsyncStorage.getItem('musicPlaylist');
        const defaultTrack: MusicTrack = { id: 'default_ost', title: 'System Soundtrack (Default)', path: DEFAULT_OST, isLocal: true, isFavorite: true };
        let tracks: MusicTrack[] = [defaultTrack];
        if (stored) {
          const parsed = JSON.parse(stored);
          const userTracks = parsed.filter((t: MusicTrack) => t.id !== 'default_ost');
          tracks = [...tracks, ...userTracks];
        }
        setPlaylist(tracks);
      } catch (e) { console.error("Audio Init Error", e); }

      playSystemSound();
      
      // Load Data
      const progData = await AsyncStorage.getItem('customPrograms');
      const loadedPrograms: CustomProgram[] = progData ? JSON.parse(progData) : [];
      setCustomPrograms(loadedPrograms);

      const data = await AsyncStorage.getItem('userData');
      if (data) {
        let user: UserData = JSON.parse(data);
        user = await checkPenalties(user, loadedPrograms); // Check for missed quests
        setUserData(user);
        setScreenState('dashboard');
      } else {
        setScreenState('setup');
      }
    }
    init();

    return () => {
      if (sound) sound.unloadAsync();
      if (systemSoundObj) systemSoundObj.unloadAsync();
    };
  }, []);

  const checkPenalties = async (user: UserData, programs: CustomProgram[]): Promise<UserData> => {
    if (!user.lastDailyQuestCompleted) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        user.lastDailyQuestCompleted = getISODate(yesterday);
        await AsyncStorage.setItem('userData', JSON.stringify(user));
        return user;
    }

    const lastDate = new Date(user.lastDailyQuestCompleted);
    const today = new Date();
    const todayStr = getISODate(today);
    
    if (user.lastDailyQuestCompleted === todayStr) return user;

    let penaltyXP = 0;
    let missedDays = 0;
    
    const checkDate = new Date(lastDate);
    checkDate.setDate(checkDate.getDate() + 1);

    while (getISODate(checkDate) < todayStr) {
        penaltyXP += PENALTY_XP;
        missedDays++;
        checkDate.setDate(checkDate.getDate() + 1);
    }

    if (penaltyXP > 0) {
        let newXP = user.xp - penaltyXP;
        let newLevel = user.level;

        while (newXP < 0) {
            if (newLevel > 1) {
                newLevel--;
                const xpForPrevLevel = newLevel * XP_PER_LEVEL_BASE;
                newXP = xpForPrevLevel + newXP;
            } else {
                newXP = 0;
                break;
            }
        }

        user.xp = newXP;
        user.level = newLevel;

        showAlert(
          "PENALTY SYSTEM", 
          `You failed to complete daily quests for ${missedDays} day(s).\n\nPUNISHMENT: -${penaltyXP} XP.\n${user.level < (JSON.parse(await AsyncStorage.getItem('userData') || '{}').level || user.level) ? 'YOUR LEVEL HAS DECREASED.' : ''}`
        );
        
        await AsyncStorage.setItem('userData', JSON.stringify(user));
    }

    return user;
  };

  // UI Updater for Music Slider
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (sound && isPlaying) {
      interval = setInterval(async () => {
        try {
            const status = await sound.getStatusAsync();
            if (status.isLoaded) {
                setPosition(status.positionMillis / 1000);
                setDuration(status.durationMillis ? status.durationMillis / 1000 : 1);
            }
        } catch (e) {}
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [sound, isPlaying]);

  const handleAutoNext = async (currentSound: Audio.Sound) => {
    const list = playlistRef.current;
    const curr = currentTrackRef.current;
    const mode = playbackModeRef.current;

    if (!curr || list.length === 0) return;

    if (mode === 'loop_one') {
      await currentSound.replayAsync();
    } 
    else if (mode === 'play_one') {
      setIsPlaying(false); setPosition(0);
      await currentSound.stopAsync();
      await currentSound.setPositionAsync(0);
    } 
    else if (mode === 'play_all') {
      const idx = list.findIndex(t => t.id === curr.id);
      if (idx !== -1 && idx < list.length - 1) {
        playTrack(list[idx + 1]);
      } else {
        setIsPlaying(false); setPosition(0);
        await currentSound.stopAsync();
        await currentSound.setPositionAsync(0);
      }
    } 
    else if (mode === 'loop_all') {
      const idx = list.findIndex(t => t.id === curr.id);
      const nextIdx = (idx + 1) % list.length;
      playTrack(list[nextIdx]);
    }
  };

  const saveUserData = async (data: UserData) => {
    await AsyncStorage.setItem('userData', JSON.stringify(data));
    setUserData(data);
  };

  const updateCustomPrograms = async (programs: CustomProgram[]) => {
      setCustomPrograms(programs);
      await AsyncStorage.setItem('customPrograms', JSON.stringify(programs));
  };

  // --- Music Controls ---
  const playTrack = async (track: MusicTrack) => {
    if (musicLoading) return;
    
    // Prevent re-creating player if user taps the playing song
    if (currentTrack?.id === track.id && sound) {
        const status = await sound.getStatusAsync();
        if(status.isLoaded && !status.isPlaying) {
             await sound.playAsync();
             setIsPlaying(true);
             return;
        }
    }

    try {
      setMusicLoading(true);
      
      // Release old player safely
      if (sound) { 
          await sound.unloadAsync();
          setSound(null);
      }

      const source = track.isLocal ? track.path : { uri: track.path };
      const mode = playbackModeRef.current;
      const shouldLoop = mode === 'loop_one';
      
      const { sound: newSound } = await Audio.Sound.createAsync(
          source,
          { shouldPlay: true, isLooping: shouldLoop }
      );

      newSound.setOnPlaybackStatusUpdate((status) => {
         if (status.isLoaded && status.didJustFinish && !status.isLooping) {
            handleAutoNext(newSound);
         }
      });

      if (isMuted) await newSound.setIsMutedAsync(true);

      setSound(newSound); 
      setCurrentTrack(track); 
      setIsPlaying(true);
      
      setMusicLoading(false);
    } catch (error) {
      console.log('Play Error', error);
      setMusicLoading(false);
      showAlert('Error', 'Could not play audio track.');
    }
  };

  const togglePlayPause = async () => {
    if (!sound) { 
        if (playlist.length > 0) playTrack(playlist[0]); 
        return; 
    }
    if (musicLoading) return;
    
    if (isPlaying) { 
        await sound.pauseAsync(); 
        setIsPlaying(false); 
    } else { 
        await sound.playAsync(); 
        setIsPlaying(true); 
    }
  };

  const seekTrack = async (value: number) => {
    if (sound && !musicLoading) { 
        await sound.setPositionAsync(value * 1000);
        setPosition(value); 
    }
  };

  const skipToNext = () => {
    if (!currentTrack || playlist.length === 0) return;
    const idx = playlist.findIndex(t => t.id === currentTrack.id);
    const nextIdx = (idx + 1) % playlist.length;
    playTrack(playlist[nextIdx]);
  };

  const skipToPrev = () => {
    if (!currentTrack || playlist.length === 0) return;
    const idx = playlist.findIndex(t => t.id === currentTrack.id);
    const prevIdx = idx === 0 ? playlist.length - 1 : idx - 1;
    playTrack(playlist[prevIdx]);
  };

  const deleteTrack = async (trackId: string) => {
    if (trackId === 'default_ost') return;
    if (currentTrack?.id === trackId) { 
        if (sound) await sound.unloadAsync();
        setSound(null);
        setCurrentTrack(null);
        setIsPlaying(false); 
    }
    const newList = playlist.filter(t => t.id !== trackId);
    setPlaylist(newList);
    AsyncStorage.setItem('musicPlaylist', JSON.stringify(newList));
  };

  const addMusicFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        const newTrack: MusicTrack = { id: Date.now().toString(), title: file.name, path: file.uri, isLocal: false, isFavorite: false };
        const newList = [...playlist, newTrack];
        setPlaylist(newList);
        AsyncStorage.setItem('musicPlaylist', JSON.stringify(newList));
      }
    } catch (e) { showAlert('Error', 'Failed to pick audio file'); }
  };

  // --- Mini Player ---
  const MiniPlayer = () => {
    if (!currentTrack) return null;
    return (
      <TouchableOpacity activeOpacity={0.9} onPress={() => navigateTo('music')} style={styles.miniPlayerContainer}>
         <View style={styles.miniProgressContainer}><View style={[styles.miniProgressFill, { width: `${(position / (duration || 1)) * 100}%` }]} /></View>
         <View style={styles.miniPlayerContent}>
            <View style={styles.miniInfo}>
               {currentTrack.artwork ? ( <Image source={{ uri: currentTrack.artwork }} style={styles.miniArt} /> ) : ( <Ionicons name="musical-note" size={20} color={COLORS.blue} style={{marginRight: 10}} /> )}
               <View><Text style={styles.miniTitle} numberOfLines={1}>{currentTrack.title}</Text><Text style={styles.miniTime}>{formatTime(position)} / {formatTime(duration)}</Text></View>
            </View>
            <View style={styles.miniControls}>
               <TouchableOpacity onPress={(e) => { e.stopPropagation(); skipToPrev(); }} style={styles.miniCtrlBtn}><Ionicons name="play-skip-back" size={20} color={COLORS.text} /></TouchableOpacity>
               <TouchableOpacity onPress={(e) => { e.stopPropagation(); togglePlayPause(); }} style={styles.miniCtrlBtn}><Ionicons name={isPlaying ? "pause" : "play"} size={26} color={COLORS.white} /></TouchableOpacity>
               <TouchableOpacity onPress={(e) => { e.stopPropagation(); skipToNext(); }} style={styles.miniCtrlBtn}><Ionicons name="play-skip-forward" size={20} color={COLORS.text} /></TouchableOpacity>
            </View>
         </View>
      </TouchableOpacity>
    );
  };

  // --- Render Current Screen ---
  const renderScreen = () => {
    if (!userData && screen !== 'loading' && screen !== 'setup') return <LoadingScreen />;

    switch (screen) {
      case 'loading': return <LoadingScreen />;
      case 'setup': 
        return <SetupScreen onComplete={(data) => { setUserData(data); setScreenState('assessment'); }} />;
      case 'assessment':
        return <AssessmentScreen userData={userData!} onComplete={(stats, calculatedLevel) => {
            const finalData = { ...userData!, level: calculatedLevel, assessmentStats: stats, createdAt: new Date().toISOString(), lastDailyQuestCompleted: getISODate(new Date()) };
            saveUserData(finalData);
            navigateTo('dashboard');
        }} />;
      case 'dashboard': 
        return <DashboardScreen userData={userData!} onNavigate={navigateTo} onStartQuest={() => navigateTo('quest')} />;
      case 'quest': 
        return <QuestScreen 
          userData={userData!} 
          customPrograms={customPrograms}
          onBack={() => navigateTo('dashboard')}
          onStartTraining={(quest) => { setCurrentQuest(quest); setIsTraining(true); navigateTo('training'); }}
        />;
      case 'training':
        return <TrainingScreen 
          userData={userData!} 
          quest={currentQuest!} 
          showAlert={showAlert} // Passing alert handler
          onComplete={(results, duration) => { updateProgress(results, duration); navigateTo('dashboard'); }}
          onBack={() => { 
            showAlert("Abort Mission?", "Stop training?", [
              { text: "Cancel", style: "cancel" }, 
              { text: "Quit", style: "destructive", onPress: () => navigateTo('dashboard') }
            ]); 
          }}
        />;
      case 'stats': return <StatsScreen userData={userData!} onBack={() => navigateTo('dashboard')} />;
      case 'music': return <MusicScreen 
          playlist={playlist} currentTrack={currentTrack} isPlaying={isPlaying} isLoading={musicLoading}
          position={position} duration={duration} playbackMode={playbackMode}
          onPlay={playTrack} onPause={togglePlayPause} onSeek={seekTrack} onNext={skipToNext} onPrev={skipToPrev} onDelete={deleteTrack} onAdd={addMusicFile}
          onToggleMode={async () => {
            const modes: PlaybackMode[] = ['loop_all', 'play_all', 'loop_one', 'play_one'];
            const nextMode = modes[(modes.indexOf(playbackMode) + 1) % modes.length];
            setPlaybackMode(nextMode);
            // Sync current player native loop property
            if(sound) await sound.setIsLoopingAsync(nextMode === 'loop_one');
          }}
          onBack={() => navigateTo('dashboard')} 
        />;
      case 'programs': return <CustomProgramsScreen 
          userData={userData!} 
          customPrograms={customPrograms}
          setCustomPrograms={updateCustomPrograms}
          onBack={() => navigateTo('dashboard')} 
          onStartProgram={(quest) => { setCurrentQuest(quest); setIsTraining(true); navigateTo('training'); }}
          showAlert={showAlert}
        />;
      case 'settings': return <SettingsScreen userData={userData!} onSave={(data) => { saveUserData(data); navigateTo('dashboard'); }} onBack={() => navigateTo('dashboard')} />;
      default: return <LoadingScreen />;
    }
  };

  const updateProgress = async (results: TrainingResult, duration: number) => {
    try {
      let xpGained = 0;
      if (currentQuest?.isDaily) {
          xpGained = currentQuest.rewards.xp;
          const todayStr = getISODate(new Date());
          userData!.lastDailyQuestCompleted = todayStr;
      } else {
          xpGained = 100;
      }

      const history = await AsyncStorage.getItem('trainingHistory');
      const parsed: TrainingHistory[] = history ? JSON.parse(history) : [];
      const newEntry: TrainingHistory = { date: new Date().toISOString(), quest: currentQuest!, results: results, xpGained: xpGained, durationSeconds: duration };
      parsed.push(newEntry);
      await AsyncStorage.setItem('trainingHistory', JSON.stringify(parsed));

      const xpNeeded = userData!.level * XP_PER_LEVEL_BASE;
      let newTotalXP = userData!.xp + xpGained;
      let newLevel = userData!.level;
      let leveledUp = false;

      while (newTotalXP >= xpNeeded) {
        newTotalXP -= xpNeeded;
        newLevel++;
        leveledUp = true;
      }

      const newUserData: UserData = {
        ...userData!, xp: newTotalXP, level: newLevel, totalWorkouts: (userData!.totalWorkouts || 0) + 1,
      };
      
      if (leveledUp) {
        showAlert('LEVEL UP!', `You have reached Level ${newLevel}!`);
      } else {
        showAlert('QUEST COMPLETED', `You gained ${xpGained} Experience Points.`);
      }
      saveUserData(newUserData);
    } catch (error) { console.error('Error updating progress:', error); }
  };

  return (
  <SafeAreaProvider>
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} translucent={false} />
      
      {/* Main content - takes remaining space */}
      <View style={{ flex: 1 }}>
        {renderScreen()}
      </View>
      
      {/* Mini player - natural bottom position */}
      {currentTrack && screen !== 'music' && <MiniPlayer />}
      
      <CustomAlert {...alertState} onClose={closeAlert} />
    </SafeAreaView>
  </SafeAreaProvider>
);
}

// --- Screens ---

function LoadingScreen() {
  const spinValue = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.loop(Animated.timing(spinValue, { toValue: 1, duration: 2000, useNativeDriver: true })).start(); }, []);
  const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={styles.centerContainer}>
      <Animated.View style={{ transform: [{ rotate: spin }], marginBottom: 20 }}><Ionicons name="reload-circle-outline" size={60} color={COLORS.blue} /></Animated.View>
      <Text style={styles.loadingTitle}>SOLO LEVELING</Text><Text style={styles.loadingSubtitle}>INITIALIZING SYSTEM...</Text>
    </View>
  );
}

function SetupScreen({ onComplete }: { onComplete: (data: UserData) => void }) {
  const [formData, setFormData] = useState<any>({ name: '', level: 1, sex: 'male', weight: '', height: '', goal: 'muscle' });
  const [image, setImage] = useState<string | null>(null);
  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5 });
    if (!result.canceled) setImage(result.assets[0].uri);
  };
  const handleNext = () => {
    if (!formData.name) return;
    onComplete({ ...formData, weight: parseFloat(formData.weight) || 70, height: parseFloat(formData.height) || 170, xp: 0, totalWorkouts: 0, createdAt: new Date().toISOString(), cameraEnabled: false, profileImage: image || undefined });
  };
  const GoalButton = ({ type, icon, label }: { type: GoalType, icon: string, label: string }) => (
    <TouchableOpacity style={[styles.goalBtn, formData.goal === type && styles.goalBtnActive]} onPress={() => setFormData({...formData, goal: type})}>
        <MaterialCommunityIcons name={icon as any} size={24} color={formData.goal === type ? COLORS.white : COLORS.blue} />
        <Text style={formData.goal === type ? styles.goalTextActive : styles.goalText}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <ScrollView style={styles.screenContainer} contentContainerStyle={{padding: 20}} showsVerticalScrollIndicator={false}>
      <Text style={styles.headerTitle}>PLAYER REGISTRATION</Text>
      <TouchableOpacity onPress={pickImage} style={styles.avatarPicker}>
        {image ? ( <Image source={{ uri: image }} style={styles.avatarImage} /> ) : ( <View style={styles.avatarPlaceholder}><Ionicons name="camera" size={40} color={COLORS.textDark} /><Text style={styles.avatarText}>ADD PHOTO</Text></View> )}
      </TouchableOpacity>
      <View style={styles.formGroup}><Text style={styles.label}>HUNTER NAME</Text><TextInput style={styles.input} placeholder="Enter Name" placeholderTextColor={COLORS.textDark} onChangeText={t => setFormData({...formData, name: t})} /></View>
      <View style={styles.formGroup}><Text style={styles.label}>GOAL / CLASS</Text><GoalButton type="muscle" icon="arm-flex" label="Muscle & Strength" /><GoalButton type="weight_loss" icon="run-fast" label="Weight Loss" /><GoalButton type="speed_strength" icon="flash" label="Speed & Strength (Assassin)" /></View>
      <View style={styles.formGroup}><Text style={styles.label}>GENDER</Text><View style={styles.genderContainer}><TouchableOpacity style={[styles.genderBtn, formData.sex === 'male' && styles.genderBtnActive]} onPress={() => setFormData({...formData, sex: 'male'})}><Ionicons name="male" size={20} color={formData.sex === 'male' ? COLORS.white : COLORS.blue} /><Text style={formData.sex === 'male' ? styles.genderTextActive : styles.genderText}>MALE</Text></TouchableOpacity><TouchableOpacity style={[styles.genderBtn, formData.sex === 'female' && styles.genderBtnActive]} onPress={() => setFormData({...formData, sex: 'female'})}><Ionicons name="female" size={20} color={formData.sex === 'female' ? COLORS.white : COLORS.blue} /><Text style={formData.sex === 'female' ? styles.genderTextActive : styles.genderText}>FEMALE</Text></TouchableOpacity></View></View>
      <View style={styles.row}><View style={[styles.formGroup, {flex:1, marginRight: 10}]}><Text style={styles.label}>WEIGHT (KG)</Text><TextInput style={styles.input} keyboardType="numeric" onChangeText={t => setFormData({...formData, weight: t})} /></View><View style={[styles.formGroup, {flex:1}]}><Text style={styles.label}>HEIGHT (CM)</Text><TextInput style={styles.input} keyboardType="numeric" onChangeText={t => setFormData({...formData, height: t})} /></View></View>
      <TouchableOpacity style={styles.mainButton} onPress={handleNext}><Text style={styles.mainButtonText}>PROCEED TO EVALUATION</Text></TouchableOpacity>
    </ScrollView>
  );
}

function AssessmentScreen({ userData, onComplete }: { userData: UserData, onComplete: (stats: any, level: number) => void }) {
    const [step, setStep] = useState<'intro' | 'active' | 'rest' | 'input'>('intro');
    const [currentExIndex, setCurrentExIndex] = useState(0);
    const [timer, setTimer] = useState(0);
    const [reps, setReps] = useState('');
    const [results, setResults] = useState<{[key:string]: number}>({});

    const getExercises = () => {
        if (userData.goal === 'speed_strength') return ['pushups', 'jumpSquats', 'lunges']; 
        else if (userData.goal === 'weight_loss') return ['squats', 'situps', 'lunges']; 
        else return ['pushups', 'squats', 'situps']; 
    };

    const exercises = getExercises();
    const currentEx = exercises[currentExIndex];
    const EX_TIME = 60; const REST_TIME = 15;

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if ((step === 'active' || step === 'rest') && timer > 0) {
            interval = setInterval(() => {
                setTimer(prev => {
                    if (prev <= 1) {
                        if (step === 'active') { Vibration.vibrate(); setStep('input'); } 
                        else if (step === 'rest') {
                            if (currentExIndex < exercises.length - 1) { setCurrentExIndex(prevIdx => prevIdx + 1); startExercise(); } 
                            else { finishAssessment(); }
                        }
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [step, timer]);

    const startExercise = () => { setTimer(EX_TIME); setStep('active'); setReps(''); };
    const handleInput = () => {
        const count = parseInt(reps) || 0;
        setResults(prev => ({...prev, [currentEx]: count}));
        if (currentExIndex < exercises.length - 1) { setTimer(REST_TIME); setStep('rest'); } 
        else { finishAssessment(count); }
    };

    const finishAssessment = (lastReps?: number) => {
        const finalResults = lastReps ? {...results, [currentEx]: lastReps} : results;
        let totalReps = 0; Object.values(finalResults).forEach(val => totalReps += val);
        const calculatedLevel = Math.max(1, Math.floor(totalReps / 40) + 1);
        onComplete(finalResults, calculatedLevel);
    };

    return (
        <View style={styles.centerContainer}>
            <Text style={styles.headerTitle}>SYSTEM EVALUATION</Text>
            {step === 'intro' && (
                <View style={{padding: 20, alignItems: 'center'}}>
                    <Text style={styles.questTitleDark}>RANKING TEST</Text>
                    <Text style={styles.alertMessage}>You will perform 3 exercises to determine your Hunter Rank. {"\n\n"}1 Minute MAX reps for each.{"\n"}15 Seconds rest between sets.</Text>
                    {exercises.map(e => ( <View key={e} style={{flexDirection:'row', marginVertical: 5}}><SoloIcon name={EXERCISES[e].iconName} lib={EXERCISES[e].iconLib} color={COLORS.blue} /><Text style={{color: COLORS.text, marginLeft: 10}}>{EXERCISES[e].name}</Text></View> ))}
                    <TouchableOpacity style={styles.mainButton} onPress={startExercise}><Text style={styles.mainButtonText}>START TEST</Text></TouchableOpacity>
                </View>
            )}
            {step === 'active' && (
                <View style={{alignItems: 'center'}}>
                    <Text style={styles.loadingSubtitle}>CURRENT EXERCISE</Text><Text style={styles.loadingTitle}>{EXERCISES[currentEx].name}</Text>
                    <View style={styles.timerCircle}><Text style={styles.timerText}>{timer}</Text></View><Text style={styles.label}>DO AS MANY AS YOU CAN</Text>
                </View>
            )}
            {step === 'input' && (
                <View style={{alignItems: 'center', width: '80%'}}>
                    <Text style={styles.questTitleDark}>TIME'S UP</Text><Text style={styles.label}>ENTER REPS COMPLETED:</Text>
                    <TextInput style={[styles.input, {textAlign: 'center', fontSize: 24, width: 100}]} keyboardType="numeric" value={reps} onChangeText={setReps} autoFocus />
                    <TouchableOpacity style={styles.mainButton} onPress={handleInput}><Text style={styles.mainButtonText}>CONFIRM</Text></TouchableOpacity>
                </View>
            )}
            {step === 'rest' && (
                <View style={{alignItems: 'center'}}>
                    <Text style={styles.loadingTitle}>REST</Text><Text style={styles.timerText}>{timer}</Text><Text style={styles.loadingSubtitle}>NEXT: {EXERCISES[exercises[currentExIndex + 1]]?.name}</Text>
                </View>
            )}
        </View>
    );
}

function DashboardScreen({ userData, onNavigate, onStartQuest }: any) {
  if (!userData) return null;
  const xpPercent = (userData.xp / (userData.level * XP_PER_LEVEL_BASE)) * 100;
  return (
    <ScrollView style={styles.screenContainer} showsVerticalScrollIndicator={false}>
      <View style={styles.dashboardHeader}>
        <View style={styles.profileRow}>
          <Image source={userData.profileImage ? { uri: userData.profileImage } : { uri: 'https://via.placeholder.com/150' }} style={styles.profileImageSmall} />
          <View><Text style={styles.playerName}>{userData.name}</Text><Text style={styles.playerRank}>LEVEL {userData.level}</Text><Text style={{color: COLORS.gold, fontSize: 10, letterSpacing: 1}}>CLASS: {userData.goal.replace('_', ' ').toUpperCase()}</Text></View>
        </View>
      </View>
      <View style={styles.systemWindow}>
        <Text style={styles.systemHeader}>STATUS</Text>
        <View style={styles.xpBarContainer}><View style={[styles.xpBarFill, { width: `${xpPercent}%` }]} /></View>
        <Text style={styles.xpText}>{userData.xp} / {userData.level * XP_PER_LEVEL_BASE} XP</Text>
        <View style={styles.statGrid}>
          <View style={styles.statItem}><Ionicons name="barbell-outline" size={20} color={COLORS.blue} /><Text style={styles.statVal}>{userData.totalWorkouts}</Text><Text style={styles.statLbl}>Raids</Text></View>
          <View style={styles.statItem}><MaterialCommunityIcons name="fire" size={20} color={COLORS.danger} /><Text style={styles.statVal}>{userData.level}</Text><Text style={styles.statLbl}>Rank</Text></View>
        </View>
      </View>
      <View style={styles.menuGrid}>
        <TouchableOpacity style={styles.menuCardLarge} onPress={onStartQuest}>
           <MaterialCommunityIcons name="sword-cross" size={40} color={COLORS.gold} /><Text style={styles.menuTitle}>DAILY QUEST</Text><Text style={styles.menuSub}>{userData.lastDailyQuestCompleted === getISODate(new Date()) ? 'Completed' : 'Available'}</Text>
        </TouchableOpacity>
        <View style={styles.menuRow}>
           <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('programs')}><Ionicons name="list" size={24} color={COLORS.blue} /><Text style={styles.menuTitleSmall}>Programs</Text></TouchableOpacity>
           <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('stats')}><Ionicons name="stats-chart" size={24} color={COLORS.success} /><Text style={styles.menuTitleSmall}>Stats</Text></TouchableOpacity>
        </View>
        <View style={styles.menuRow}>
           <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('music')}><Ionicons name="musical-notes" size={24} color={COLORS.purple} /><Text style={styles.menuTitleSmall}>Music</Text></TouchableOpacity>
           <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('settings')}><Ionicons name="settings" size={24} color={COLORS.textDark} /><Text style={styles.menuTitleSmall}>Settings</Text></TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

function MusicScreen({ playlist, currentTrack, isPlaying, isLoading, position, duration, playbackMode, onPlay, onPause, onSeek, onNext, onPrev, onDelete, onAdd, onToggleMode, onBack }: any) {
  const [searchQuery, setSearchQuery] = useState('');
  const getModeIcon = () => {
    switch(playbackMode) {
      case 'loop_one': return 'repeat-once';
      case 'loop_all': return 'repeat';
      case 'play_one': return 'numeric-1-box-outline';
      case 'play_all': return 'playlist-play';
      default: return 'repeat';
    }
  };
  const filteredPlaylist = playlist.filter((track: MusicTrack) => track.title.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>MUSIC PLAYER</Text>
        <TouchableOpacity onPress={onToggleMode} style={styles.modeBtnHeader}><MaterialCommunityIcons name={getModeIcon()} size={20} color={COLORS.blue} /></TouchableOpacity>
      </View>
      <View style={styles.playerMain}>
        {currentTrack && currentTrack.artwork ? ( <Image source={{uri: currentTrack.artwork}} style={styles.albumArt} /> ) : ( <View style={styles.albumArtPlaceholder}><Ionicons name="musical-note" size={80} color={COLORS.highlight} /></View> )}
        <Text style={styles.nowPlayingTitle} numberOfLines={1}>{currentTrack ? currentTrack.title : 'Select a Track'}</Text>
        <View style={styles.seekContainer}>
          <Text style={styles.timeText}>{formatTime(position)}</Text>
          <Slider style={{flex: 1, marginHorizontal: 10}} minimumValue={0} maximumValue={duration > 0 ? duration : 1} value={position} minimumTrackTintColor={COLORS.highlight} maximumTrackTintColor={COLORS.accent} thumbTintColor={COLORS.blue} onSlidingComplete={onSeek} />
          <Text style={styles.timeText}>{formatTime(duration)}</Text>
        </View>
        <View style={styles.playerControlsMain}>
           <TouchableOpacity onPress={onPrev} style={styles.ctrlBtn}><Ionicons name="play-skip-back" size={30} color={COLORS.text} /></TouchableOpacity>
           <TouchableOpacity onPress={onPause} style={styles.playButtonLarge}>{isLoading ? ( <View style={{width: 30, height: 30, borderWidth: 3, borderRadius: 15, borderColor: COLORS.primary, borderTopColor: COLORS.blue}} /> ) : ( <Ionicons name={isPlaying ? "pause" : "play"} size={40} color={COLORS.primary} /> )}</TouchableOpacity>
           <TouchableOpacity onPress={onNext} style={styles.ctrlBtn}><Ionicons name="play-skip-forward" size={30} color={COLORS.text} /></TouchableOpacity>
        </View>
      </View>
      <View style={styles.playlistHeader}><Text style={styles.sectionTitle}>PLAYLIST</Text><TouchableOpacity onPress={onAdd} style={styles.addBtn}><Ionicons name="add" size={20} color={COLORS.primary} /></TouchableOpacity></View>
      <View style={{paddingHorizontal: 20, marginBottom: 5}}><View style={styles.searchContainer}><Ionicons name="search" size={20} color={COLORS.textDark} /><TextInput style={styles.searchInput} placeholder="Search tracks..." placeholderTextColor={COLORS.textDark} value={searchQuery} onChangeText={setSearchQuery} /></View></View>
      <ScrollView 
        style={styles.playlistContainer} 
        contentContainerStyle={{ paddingBottom: 20 }} // Fix for list overflow
        showsVerticalScrollIndicator={false}
      >
        {filteredPlaylist.map((track: MusicTrack) => (
          <View key={track.id} style={[styles.trackRow, currentTrack?.id === track.id && styles.trackActive]}>
            <TouchableOpacity style={styles.trackInfoArea} onPress={() => onPlay(track)}>
              <View style={styles.trackIcon}><Ionicons name="musical-notes-outline" size={20} color={currentTrack?.id === track.id ? COLORS.white : COLORS.textDark} /></View>
              <Text style={[styles.trackName, currentTrack?.id === track.id && styles.trackNameActive]} numberOfLines={1}>{track.title}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(track.id)}><Ionicons name="trash-outline" size={18} color={COLORS.danger} /></TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function TrainingScreen({ userData, quest, onComplete, onBack, showAlert }: any) {
  const [counts, setCounts] = useState<TrainingResult>({});
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraType, setCameraType] = useState('front'); 
  const [workoutTime, setWorkoutTime] = useState(0);
  const [activeExercise, setActiveExercise] = useState<string | null>(null);
  const [manualInputs, setManualInputs] = useState<{[key:string]: string}>({});
  
  const cameraRef = useRef<any>(null);

  useEffect(() => {
    if (!permission) requestPermission();
    const initCounts: any = {}; Object.keys(quest.exercises).forEach(k => initCounts[k] = 0); setCounts(initCounts);
  }, [permission]);

  // Workout Timer
  useEffect(() => {
    const timer = setInterval(() => {
        setWorkoutTime(t => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleManualAdd = (ex: string, target: number) => { 
      const amount = parseInt(manualInputs[ex] || '0');
      if (amount > 0) {
          const current = counts[ex] || 0; 
          const newVal = Math.min(current + amount, target);
          setCounts({...counts, [ex]: newVal});
          setManualInputs({...manualInputs, [ex]: ''});
      }
  };

  const handleDecrease = (ex: string) => {
      const current = counts[ex] || 0;
      if (current > 0) setCounts({...counts, [ex]: current - 1});
  };

  const handleCheckAll = () => {
    showAlert("Complete All?", "Mark all exercises as finished?", [
        { text: "Cancel", style: "cancel" },
        { text: "Yes", onPress: () => setCounts(quest.exercises) }
    ]);
  };

  const isCompleted = (ex: string) => (counts[ex] || 0) >= quest.exercises[ex];
  const allCompleted = Object.keys(quest.exercises).every(isCompleted);

  // Determine if active exercise is supported by pose detection logic
  const isPoseSupported = (exKey: string) => PoseCalculator.isSupported(exKey);

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}><Ionicons name="close" size={24} color={COLORS.danger} /></TouchableOpacity>
        <Text style={styles.headerTitle}>DUNGEON INSTANCE</Text>
        <View style={styles.timerBadge}>
             <Ionicons name="timer-outline" size={16} color={COLORS.gold} />
             <Text style={styles.timerValue}>{formatTime(workoutTime)}</Text>
        </View>
        <TouchableOpacity onPress={() => setCameraType(cameraType === 'back' ? 'front' : 'back')}><Ionicons name="camera-reverse" size={24} color={COLORS.blue} /></TouchableOpacity>
      </View>
      
      {userData.cameraEnabled && (
        <View style={styles.cameraContainer}>
          {permission?.granted ? (
            <CameraView style={styles.camera} facing={cameraType as any} ref={cameraRef}>
               <View style={styles.cameraOverlay}>
                  <Text style={styles.detectionText}>SYSTEM: POSE TRACKING ACTIVE</Text>
                  
                  {activeExercise && !isPoseSupported(activeExercise) ? (
                      <View style={styles.camWarningBox}>
                          <Text style={styles.camWarningText}>CANNOT DETECT WITH CAM</Text>
                      </View>
                  ) : (
                      <View style={styles.poseBox} />
                  )}
  
                  {activeExercise && isPoseSupported(activeExercise) && (
                      <View style={styles.poseInfoBox}>
                          <Text style={styles.poseInfoText}>Detecting: {EXERCISES[activeExercise]?.name || activeExercise}</Text>
                          <Text style={styles.poseInfoSub}>Ensure full body visibility</Text>
                      </View>
                  )}
               </View>
            </CameraView>
          ) : (
             <View style={styles.cameraOff}>
                 <Ionicons name="videocam-off" size={40} color={COLORS.textDark} />
                 <Text style={styles.cameraOffText}>CAMERA DISABLED</Text>
                 <Text style={styles.cameraOffSub}>Enable in Settings for Auto-Count</Text>
             </View>
          )}
        </View>
      )}

      <ScrollView style={styles.exerciseList} contentContainerStyle={{paddingBottom: 20}} showsVerticalScrollIndicator={false}>
        {Object.entries(quest.exercises).map(([key, target]: [string, any]) => {
          const def = quest.customExercises?.[key] || EXERCISES[key] || { name: key, iconName: 'help', iconLib: 'Ionicons' };
          const count = counts[key] || 0;
          const completed = isCompleted(key);
          
          return (
            <TouchableOpacity 
                key={key} 
                style={[styles.exerciseCard, completed && styles.exerciseCardDone, activeExercise === key && styles.exerciseCardActive]}
                onPress={() => setActiveExercise(key)}
            >
              <View style={styles.exHeaderRow}>
                 <View style={styles.exIcon}><SoloIcon name={def.iconName} lib={def.iconLib} size={28} color={COLORS.blue} /></View>
                 <View style={{flex: 1}}>
                    <Text style={styles.exName}>{def.name}</Text>
                    <View style={styles.progressBarBg}><View style={[styles.progressBarFill, {width: `${Math.min((count/target)*100, 100)}%`}]} /></View>
                 </View>
                 <Text style={styles.countTextLarge}>{count}/{target}</Text>
              </View>

              <View style={styles.seriesControls}>
                 <TouchableOpacity style={styles.seriesBtnSmall} onPress={() => handleDecrease(key)} disabled={count === 0}>
                    <Ionicons name="remove" size={16} color={COLORS.white} />
                 </TouchableOpacity>
                 
                 <TextInput 
                    style={styles.seriesInput} 
                    placeholder="#" 
                    placeholderTextColor={COLORS.textDark}
                    keyboardType="numeric"
                    value={manualInputs[key] || ''}
                    onChangeText={(t) => setManualInputs({...manualInputs, [key]: t})}
                 />
                 
                 <TouchableOpacity style={styles.seriesBtn} onPress={() => handleManualAdd(key, target)} disabled={completed}>
                    <Text style={styles.seriesBtnText}>ADD SET</Text>
                 </TouchableOpacity>
                 
                 <TouchableOpacity style={[styles.checkBtn, completed ? styles.checkBtnDone : {}]} onPress={() => setCounts({...counts, [key]: target})}>
                    <Ionicons name="checkmark" size={18} color={COLORS.white} />
                 </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={styles.checkAllBtn} onPress={handleCheckAll}>
            <Text style={styles.checkAllText}>COMPLETE ALL EXERCISES</Text>
        </TouchableOpacity>
        
        {allCompleted && ( <TouchableOpacity style={styles.completeBtn} onPress={() => onComplete(counts, workoutTime)}><Text style={styles.completeBtnText}>COMPLETE DUNGEON</Text></TouchableOpacity> )}
      </ScrollView>
    </View>
  );
}

function CustomProgramsScreen({ userData, customPrograms, setCustomPrograms, onBack, onStartProgram, showAlert }: any) {
  const [modalVisible, setModalVisible] = useState(false);
  const [newProgName, setNewProgName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedEx, setSelectedEx] = useState<{[key:string]: number}>({});
  const [customList, setCustomList] = useState<Array<{id: string, name: string, reps: number}>>([]);
  const [customExName, setCustomExName] = useState('');
  const [customExCount, setCustomExCount] = useState('10');
  const [schedule, setSchedule] = useState<string[]>([]); // New schedule state

  const toggleExercise = (key: string) => { const next = {...selectedEx}; if (next[key]) delete next[key]; else next[key] = 10; setSelectedEx(next); };
  const updateReps = (key: string, val: string) => { const next = {...selectedEx, [key]: parseInt(val) || 0}; setSelectedEx(next); };

  const addCustomExercise = () => {
    if (!customExName) { showAlert("Error", "Enter name"); return; }
    const newEx = { id: `cust_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, name: customExName, reps: parseInt(customExCount) || 10 };
    setCustomList([...customList, newEx]); setCustomExName(''); setCustomExCount('10');
  };

  const removeCustomExercise = (id: string) => { setCustomList(customList.filter(item => item.id !== id)); };

  const toggleDay = (day: string) => {
      if (schedule.includes(day)) setSchedule(schedule.filter(d => d !== day));
      else setSchedule([...schedule, day]);
  };

  const openCreateModal = () => {
    setNewProgName(''); setEditingId(null); setSelectedEx({}); setCustomList([]); setSchedule([]); setModalVisible(true);
  };

  const openEditModal = (prog: CustomProgram) => {
    setNewProgName(prog.name); setEditingId(prog.id); setSchedule(prog.schedule || []);
    const stdEx: {[key:string]: number} = {}; const cList: Array<{id: string, name: string, reps: number}> = [];
    Object.entries(prog.exercises).forEach(([key, reps]) => {
        if(EXERCISES[key]) stdEx[key] = reps;
        else if (prog.customExercises && prog.customExercises[key]) cList.push({ id: key, name: prog.customExercises[key].name, reps: reps });
    });
    setSelectedEx(stdEx); setCustomList(cList); setModalVisible(true);
  };

  const saveProgram = () => {
    if (!newProgName) { showAlert("Error", "Name required"); return; }
    let customDefs: ExerciseConfig = {}; let finalExercises = { ...selectedEx };
    customList.forEach(item => { customDefs[item.id] = { name: item.name, iconName: 'star', iconLib: 'Ionicons', custom: true, type: 'reps' }; finalExercises[item.id] = item.reps; });
    const newProg: CustomProgram = { id: editingId ? editingId : Date.now().toString(), name: newProgName, exercises: finalExercises, customExercises: customDefs, schedule: schedule, createdAt: new Date().toISOString() };
    let updated; if(editingId) updated = customPrograms.map((p: any) => p.id === editingId ? newProg : p); else updated = [...customPrograms, newProg];
    setCustomPrograms(updated); setModalVisible(false);
  };

  const deleteProgram = (id: string) => { const updated = customPrograms.filter((p: any) => p.id !== id); setCustomPrograms(updated); };

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>CUSTOM PROGRAMS</Text>
        <TouchableOpacity onPress={openCreateModal}><Ionicons name="add-circle" size={30} color={COLORS.blue} /></TouchableOpacity>
      </View>
      <ScrollView style={{padding: 20}} showsVerticalScrollIndicator={false}>
        {customPrograms.map((p: any) => (
           <View key={p.id} style={styles.programCard}>
              <View style={{flex: 1}}>
                <Text style={styles.progTitle}>{p.name}</Text>
                <Text style={styles.progSub}>{Object.keys(p.exercises).length} Exercises</Text>
                {p.schedule && p.schedule.length > 0 && <Text style={{color: COLORS.gold, fontSize: 10}}>Scheduled: {p.schedule.join(', ')}</Text>}
              </View>
              <TouchableOpacity style={styles.startBtnSmall} onPress={() => onStartProgram({ title: p.name, difficulty: 1, exercises: p.exercises, rewards: { xp: 100, title: 'Custom' }, customExercises: p.customExercises, isDaily: false })}>
                 <Text style={styles.btnTextSmall}>START</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.editProgBtn} onPress={() => openEditModal(p)}><Ionicons name="create-outline" size={20} color={COLORS.white} /></TouchableOpacity>
              <TouchableOpacity style={styles.deleteProgBtn} onPress={() => deleteProgram(p.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger} /></TouchableOpacity>
           </View>
        ))}
      </ScrollView>
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
           <View style={styles.createModal}>
              <Text style={styles.modalTitle}>{editingId ? 'EDIT PROGRAM' : 'NEW PROGRAM'}</Text>
              <TextInput style={styles.input} placeholder="Program Name" placeholderTextColor={COLORS.textDark} value={newProgName} onChangeText={setNewProgName} />
              
              <Text style={[styles.label, {marginTop: 10}]}>Schedule as Daily Quest:</Text>
              <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10}}>
                  {WEEK_DAYS.map(day => (
                      <TouchableOpacity key={day} onPress={() => toggleDay(day)} style={[styles.dayBtn, schedule.includes(day) && styles.dayBtnActive]}>
                          <Text style={[styles.dayBtnText, schedule.includes(day) && {color: COLORS.white}]}>{day.charAt(0)}</Text>
                      </TouchableOpacity>
                  ))}
              </View>

              <ScrollView style={{height: 200, marginVertical: 10}} showsVerticalScrollIndicator={false}>
                 {Object.entries(EXERCISES).map(([k, v]) => (
                    <View key={k} style={styles.selectRowContainer}>
                        <Text style={styles.rowLabel}>{v.name}</Text>
                        <View style={{flexDirection:'row', alignItems:'center'}}>
                          {selectedEx[k] ? ( <TextInput style={styles.repsInput} keyboardType="numeric" value={String(selectedEx[k])} onChangeText={(val) => updateReps(k, val)} /> ) : null}
                          <TouchableOpacity style={[styles.checkboxBtn, selectedEx[k] ? styles.checkboxActive : {}]} onPress={() => toggleExercise(k)}><Ionicons name={selectedEx[k] ? "remove" : "add"} size={20} color={selectedEx[k] ? COLORS.white : COLORS.blue} /></TouchableOpacity>
                        </View>
                    </View>
                 ))}
                 {customList.length > 0 && <Text style={[styles.label, {marginTop: 15}]}>Added Custom:</Text>}
                 {customList.map((item) => (
                    <View key={item.id} style={styles.selectRowContainer}>
                        <View style={{flex:1}}><Text style={styles.rowLabel}>{item.name} ({item.reps} reps)</Text></View>
                        <TouchableOpacity style={styles.deleteBtn} onPress={() => removeCustomExercise(item.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger} /></TouchableOpacity>
                    </View>
                 ))}
              </ScrollView>
              
              <View style={{borderTopWidth: 1, borderTopColor: COLORS.accent, paddingTop: 10}}>
                 <Text style={styles.label}>Add Custom Exercise:</Text>
                 <View style={styles.row}>
                    <TextInput style={[styles.input, {flex: 2, marginRight: 5}]} placeholder="Name" placeholderTextColor={COLORS.textDark} value={customExName} onChangeText={setCustomExName} />
                    <TextInput style={[styles.input, {flex: 1, marginRight: 5}]} keyboardType="numeric" placeholder="Reps" placeholderTextColor={COLORS.textDark} value={customExCount} onChangeText={setCustomExCount} />
                    <TouchableOpacity style={styles.addCustomBtn} onPress={addCustomExercise}><Ionicons name="add" size={24} color={COLORS.white} /></TouchableOpacity>
                 </View>
              </View>

              <View style={[styles.row, {marginTop: 10}]}>
                 <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}><Text style={styles.btnText}>CANCEL</Text></TouchableOpacity>
                 <TouchableOpacity style={styles.saveBtn} onPress={saveProgram}><Text style={styles.btnText}>SAVE</Text></TouchableOpacity>
              </View>
           </View>
        </View>
      </Modal>
    </View>
  );
}

function StatsScreen({ userData, onBack }: any) {
  const [data, setData] = useState<number[]>([0]);
  useEffect(() => { 
    AsyncStorage.getItem('trainingHistory').then(h => { 
        if(h) { 
            const history = JSON.parse(h); 
            // Group by date (YYYY-MM-DD) and sum XP
            const grouped: {[key: string]: number} = {};
            history.forEach((entry: TrainingHistory) => {
                const dateKey = entry.date.split('T')[0];
                grouped[dateKey] = (grouped[dateKey] || 0) + entry.xpGained;
            });
            // Sort by date key to ensure order
            const sortedKeys = Object.keys(grouped).sort();
            const xpData = sortedKeys.map(k => grouped[k]);
            
            // Slice last 6 or default to [0]
            if(xpData.length > 0) setData(xpData.slice(-6));
            else setData([0]);
        } 
    }); 
  }, []);
  
  return (
    <ScrollView style={styles.screenContainer} showsVerticalScrollIndicator={false}>
       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>STATISTICS</Text><View style={{width: 24}} /></View>
      <View style={{padding: 20}}>
        <Text style={styles.sectionTitle}>XP GAIN HISTORY</Text>
        <LineChart
          data={{ labels: ["1", "2", "3", "4", "5", "6"], datasets: [{ data: data }] }}
          width={width - 40} height={220} yAxisLabel="" yAxisSuffix=" XP"
          chartConfig={{
            backgroundColor: COLORS.secondary, backgroundGradientFrom: COLORS.secondary, backgroundGradientTo: COLORS.accent,
            decimalPlaces: 0, color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`, labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
            style: { borderRadius: 16 }, propsForDots: { r: "6", strokeWidth: "2", stroke: COLORS.glow }
          }}
          style={{ marginVertical: 8, borderRadius: 16 }}
        />
        <View style={styles.statBoxLarge}><Text style={styles.bigStat}>{userData.totalWorkouts}</Text><Text style={styles.bigStatLbl}>TOTAL DUNGEONS CLEARED</Text></View>
      </View>
    </ScrollView>
  );
}

function QuestScreen({ userData, customPrograms, onBack, onStartTraining }: any) {
   // Generate Quest based on Goal and Level AND Schedule
   const getDailyQuest = (): Quest => {
      const todayDay = getDayString(new Date());
      
      // 1. Check for Scheduled Custom Program
      const scheduledProg = customPrograms.find((p: CustomProgram) => p.schedule && p.schedule.includes(todayDay));
      if (scheduledProg) {
          // Calculate XP based on level scaling roughly (standard reward for daily)
          return {
              title: `DAILY: ${scheduledProg.name.toUpperCase()}`,
              difficulty: Math.floor(userData.level / 5) + 1,
              exercises: scheduledProg.exercises,
              customExercises: scheduledProg.customExercises,
              rewards: { xp: userData.level * 150, title: 'Hunter' }, // High reward for scheduled custom
              isDaily: true
          };
      }

      // 2. Fallback to Standard Logic
      const level = userData.level;
      let exercises: {[key:string]: number} = {};
      let title = "DAILY QUEST";
      let rewardXP = level * 100; // Base reward

      if (userData.goal === 'speed_strength') {
          title = "ASSASSIN TRAINING";
          exercises = { clapPushups: Math.ceil(level * 5), jumpSquats: Math.ceil(level * 10), situps: Math.ceil(level * 10), running: Math.min(1 + (level * 0.2), 5) };
      } else if (userData.goal === 'weight_loss') {
          title = "ENDURANCE TRIAL";
          exercises = { squats: level * 15, situps: level * 15, burpees: level * 5, running: Math.min(2 + (level * 0.5), 10) };
      } else {
          title = "STRENGTH TRAINING";
          exercises = { pushups: level * 10, squats: level * 10, situps: level * 10, pullups: Math.ceil(level * 2) };
      }

      return { title, difficulty: Math.floor(level / 5) + 1, exercises, rewards: { xp: rewardXP, title: 'Hunter' }, isDaily: true };
   };

   const dailyQuest = getDailyQuest();

   return (
      <View style={styles.screenContainer}>
         <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>QUEST INFO</Text><View style={{width: 24}} /></View>
         <View style={styles.questPaperDark}>
            <Text style={styles.questTitleDark}>{dailyQuest.title}</Text>
            <Text style={styles.difficulty}>Rank: {'★'.repeat(dailyQuest.difficulty)}</Text>
            <View style={styles.divider} />
            <Text style={styles.objTitleDark}>OBJECTIVES:</Text>
            {Object.entries(dailyQuest.exercises).map(([k, v]) => (
               <View key={k} style={styles.objRow}>
                  <View style={{flexDirection: 'row', alignItems: 'center'}}>
                     <View style={{width: 6, height: 6, backgroundColor: COLORS.blue, marginRight: 8}} />
                     <Text style={styles.objTextDark}>{(dailyQuest.customExercises?.[k]?.name) || EXERCISES[k]?.name || k}</Text>
                  </View>
                  <Text style={styles.objValDark}>{v} {EXERCISES[k]?.type === 'distance' ? 'km' : ''}</Text>
               </View>
            ))}
            <View style={styles.divider} />
            <Text style={styles.rewardTitleDark}>REWARDS:</Text>
            <Text style={styles.rewardText}>+ {dailyQuest.rewards.xp} XP</Text>
         </View>
         <TouchableOpacity style={[styles.acceptBtn, userData.lastDailyQuestCompleted === getISODate(new Date()) ? {backgroundColor: COLORS.textDark} : {}]} disabled={userData.lastDailyQuestCompleted === getISODate(new Date())} onPress={() => onStartTraining(dailyQuest)}>
            <Text style={styles.acceptBtnText}>{userData.lastDailyQuestCompleted === getISODate(new Date()) ? 'QUEST COMPLETE' : 'ACCEPT QUEST'}</Text>
         </TouchableOpacity>
      </View>
   );
}

function SettingsScreen({ userData, onSave, onBack }: any) {
  const [camEnabled, setCamEnabled] = useState(userData.cameraEnabled);
  const [name, setName] = useState(userData.name);
  const [image, setImage] = useState(userData.profileImage);
  const pickImage = async () => { let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5 }); if (!result.canceled) setImage(result.assets[0].uri); };
  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>SYSTEM SETTINGS</Text><View style={{width:24}} /></View>
      <ScrollView style={{padding: 20}} showsVerticalScrollIndicator={false}>
         <View style={{alignItems: 'center', marginBottom: 20}}>
            <TouchableOpacity onPress={pickImage}><Image source={image ? { uri: image } : { uri: 'https://via.placeholder.com/150' }} style={styles.settingsAvatar} /><View style={styles.editIconBadge}><Ionicons name="camera" size={14} color={COLORS.white} /></View></TouchableOpacity>
            <Text style={[styles.label, {marginTop: 10}]}>EDIT HUNTER NAME</Text><TextInput style={[styles.input, {textAlign: 'center', width: '80%'}]} value={name} onChangeText={setName} placeholder="Hunter Name" placeholderTextColor={COLORS.textDark} />
         </View>
         <View style={styles.divider} />
         <View style={styles.settingRow}><Text style={styles.settingText}>Enable Pose Detection (Camera)</Text><TouchableOpacity onPress={() => setCamEnabled(!camEnabled)}><Ionicons name={camEnabled ? "checkbox" : "square-outline"} size={28} color={COLORS.blue} /></TouchableOpacity></View>
         <TouchableOpacity style={styles.settingsSaveBtn} onPress={() => onSave({...userData, cameraEnabled: camEnabled, name: name, profileImage: image})}><Text style={styles.settingsSaveBtnText}>SAVE CHANGES</Text></TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// --- Helpers ---
const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

// --- Styles ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.primary },
  screenContainer: { flex: 1, backgroundColor: COLORS.primary },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.primary },
  loadingTitle: { fontSize: 32, fontWeight: '900', color: COLORS.blue, letterSpacing: 4 },
  loadingSubtitle: { color: COLORS.textDark, marginTop: 10, letterSpacing: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: COLORS.accent },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', letterSpacing: 1.5 },
  timerBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: COLORS.gold },
  timerValue: { color: COLORS.gold, fontWeight: 'bold', marginLeft: 5, fontSize: 12 },
  avatarPicker: { alignSelf: 'center', marginVertical: 20 },
  avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: COLORS.accent, justifyContent: 'center', alignItems: 'center', borderStyle: 'dashed', borderWidth: 1, borderColor: COLORS.textDark },
  avatarImage: { width: 100, height: 100, borderRadius: 50 },
  avatarText: { fontSize: 10, color: COLORS.textDark, marginTop: 5 },
  formGroup: { marginBottom: 15 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { color: COLORS.blue, fontSize: 12, marginBottom: 5, fontWeight: 'bold' },
  input: { backgroundColor: COLORS.secondary, color: COLORS.text, padding: 15, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent },
  genderContainer: { flexDirection: 'row', justifyContent: 'space-between' },
  genderBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15, backgroundColor: COLORS.secondary, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent, marginHorizontal: 5 },
  genderBtnActive: { backgroundColor: COLORS.blue, borderColor: COLORS.glow },
  genderText: { color: COLORS.blue, fontWeight: 'bold', marginLeft: 8 },
  genderTextActive: { color: COLORS.white, fontWeight: 'bold', marginLeft: 8 },
  goalBtn: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: COLORS.secondary, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent, marginBottom: 8 },
  goalBtnActive: { backgroundColor: COLORS.blue, borderColor: COLORS.glow },
  goalText: { color: COLORS.blue, fontWeight: 'bold', marginLeft: 15 },
  goalTextActive: { color: COLORS.white, fontWeight: 'bold', marginLeft: 15 },
  mainButton: { backgroundColor: COLORS.blue, padding: 18, borderRadius: 8, alignItems: 'center', marginTop: 20 },
  mainButtonText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 16, letterSpacing: 2 },
  dashboardHeader: { padding: 20, paddingTop: 10 },
  profileRow: { flexDirection: 'row', alignItems: 'center' },
  profileImageSmall: { width: 60, height: 60, borderRadius: 30, marginRight: 15, borderWidth: 2, borderColor: COLORS.blue },
  playerName: { color: COLORS.text, fontSize: 22, fontWeight: 'bold' },
  playerRank: { color: COLORS.glow, fontSize: 12, letterSpacing: 1 },
  systemWindow: { margin: 20, padding: 20, backgroundColor: COLORS.secondary, borderRadius: 12, borderWidth: 1, borderColor: COLORS.blue },
  systemHeader: { color: COLORS.text, textAlign: 'center', fontWeight: 'bold', marginBottom: 15 },
  xpBarContainer: { height: 6, backgroundColor: COLORS.accent, borderRadius: 3, marginBottom: 5 },
  xpBarFill: { height: '100%', backgroundColor: COLORS.blue, borderRadius: 3 },
  xpText: { color: COLORS.textDark, fontSize: 10, textAlign: 'right', marginBottom: 15 },
  statGrid: { flexDirection: 'row', justifyContent: 'space-around' },
  statItem: { alignItems: 'center' },
  statVal: { color: COLORS.text, fontSize: 18, fontWeight: 'bold' },
  statLbl: { color: COLORS.textDark, fontSize: 10 },
  menuGrid: { padding: 20 },
  menuCardLarge: { backgroundColor: COLORS.accent, padding: 20, borderRadius: 12, alignItems: 'center', marginBottom: 15, borderWidth: 1, borderColor: COLORS.gold },
  menuTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', marginTop: 10 },
  menuSub: { color: COLORS.danger, fontSize: 12 },
  menuRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
  menuCardSmall: { backgroundColor: COLORS.secondary, width: '48%', padding: 15, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.accent },
  menuTitleSmall: { color: COLORS.text, marginTop: 5, fontSize: 12 },
  playerMain: { alignItems: 'center', padding: 20 },
  albumArtPlaceholder: { width: 140, height: 140, backgroundColor: COLORS.secondary, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 15, borderWidth: 1, borderColor: COLORS.accent },
  albumArt: { width: 140, height: 140, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: COLORS.accent },
  nowPlayingTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', marginBottom: 10, textAlign: 'center' },
  seekContainer: { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 15 },
  timeText: { color: COLORS.textDark, fontSize: 10, width: 35, textAlign: 'center' },
  playerControlsMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', width: '80%' },
  playButtonLarge: { width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.blue, justifyContent: 'center', alignItems: 'center' },
  ctrlBtn: { padding: 10 },
  modeBtnHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, padding: 5, borderRadius: 5, borderWidth: 1, borderColor: COLORS.accent },
  playlistHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginTop: 10 },
  sectionTitle: { color: COLORS.blue, fontWeight: 'bold' },
  addBtn: { backgroundColor: COLORS.highlight, padding: 5, borderRadius: 4 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: COLORS.accent, marginTop: 10 },
  searchInput: { flex: 1, color: COLORS.text, marginLeft: 10, paddingVertical: 5 },
  playlistContainer: { padding: 20 },
  trackRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.accent, justifyContent: 'space-between' },
  trackActive: { backgroundColor: COLORS.accent },
  trackInfoArea: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  trackIcon: { width: 30 },
  trackName: { color: COLORS.textDark, flex: 1, fontSize: 14, marginLeft: 5 },
  trackNameActive: { color: COLORS.white, fontWeight: 'bold', textShadowColor: COLORS.glow, textShadowRadius: 8 },
  deleteBtn: { padding: 5 },
  miniPlayerContainer: { position: 'relative', bottom: 0, left: 0, right: 0, height: 70, backgroundColor: COLORS.secondary, borderTopWidth: 1, borderTopColor: COLORS.blue, zIndex: 999 },
  miniProgressContainer: { height: 2, backgroundColor: COLORS.accent, width: '100%' },
  miniProgressFill: { height: '100%', backgroundColor: COLORS.highlight },
  miniPlayerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, flex: 1 },
  miniInfo: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 10 },
  miniArt: { width: 40, height: 40, borderRadius: 4, marginRight: 10 },
  miniTitle: { color: COLORS.white, fontWeight: 'bold', fontSize: 14 },
  miniTime: { color: COLORS.textDark, fontSize: 10 },
  miniControls: { flexDirection: 'row', alignItems: 'center' },
  miniCtrlBtn: { marginHorizontal: 8 },
  cameraContainer: { height: 250, backgroundColor: '#000', overflow: 'hidden' },
  camera: { flex: 1 },
  cameraOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  detectionText: { color: COLORS.success, fontSize: 10, position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', padding: 4 },
  poseBox: { width: 200, height: 300, borderWidth: 2, borderColor: COLORS.glow, opacity: 0.5 },
  camWarningBox: { backgroundColor: 'rgba(239, 68, 68, 0.8)', padding: 10, borderRadius: 5 },
  camWarningText: { color: COLORS.white, fontWeight: 'bold' },
  poseInfoBox: { position: 'absolute', bottom: 10, left: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 5 },
  poseInfoText: { color: COLORS.success, fontWeight: 'bold', fontSize: 12 },
  poseInfoSub: { color: COLORS.textDark, fontSize: 10 },
  cameraOff: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.secondary },
  cameraOffText: { color: COLORS.text, fontWeight: 'bold', marginTop: 10 },
  cameraOffSub: { color: COLORS.textDark, fontSize: 10 },
  exerciseList: { flex: 1, padding: 20 },
  exerciseCard: { backgroundColor: COLORS.secondary, padding: 15, marginBottom: 10, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent },
  exerciseCardActive: { borderColor: COLORS.blue, backgroundColor: '#1e293b' },
  exerciseCardDone: { opacity: 0.6, borderColor: COLORS.success },
  exHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  exIcon: { width: 40 },
  exName: { color: COLORS.text, fontWeight: 'bold', marginBottom: 5 },
  progressBarBg: { height: 4, backgroundColor: COLORS.accent, borderRadius: 2, width: '90%' },
  progressBarFill: { height: '100%', backgroundColor: COLORS.blue, borderRadius: 2 },
  countTextLarge: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' },
  seriesControls: { flexDirection: 'row', alignItems: 'center', marginTop: 5, justifyContent: 'flex-end' },
  seriesInput: { width: 50, height: 35, backgroundColor: COLORS.primary, color: COLORS.white, textAlign: 'center', borderRadius: 4, borderWidth: 1, borderColor: COLORS.accent, marginHorizontal: 5 },
  seriesBtn: { backgroundColor: COLORS.blue, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 4, marginHorizontal: 5 },
  seriesBtnSmall: { backgroundColor: COLORS.accent, width: 35, height: 35, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  seriesBtnText: { color: COLORS.white, fontSize: 10, fontWeight: 'bold' },
  checkBtn: { width: 35, height: 35, borderRadius: 17.5, borderWidth: 1, borderColor: COLORS.textDark, alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
  checkBtnDone: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  checkAllBtn: { marginVertical: 10, padding: 10, borderWidth: 1, borderColor: COLORS.blue, borderRadius: 8, alignItems: 'center' },
  checkAllText: { color: COLORS.blue, fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
  completeBtn: { backgroundColor: COLORS.blue, margin: 20, padding: 15, borderRadius: 8, alignItems: 'center' },
  completeBtnText: { color: COLORS.primary, fontWeight: 'bold', letterSpacing: 2 },
  programCard: { backgroundColor: COLORS.secondary, padding: 15, borderRadius: 8, marginBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progTitle: { color: COLORS.text, fontSize: 16, fontWeight: 'bold' },
  progSub: { color: COLORS.textDark, fontSize: 12 },
  startBtnSmall: { backgroundColor: COLORS.success, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4, marginRight: 10 },
  editProgBtn: { backgroundColor: COLORS.accent, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4, marginRight: 10 },
  deleteProgBtn: { padding: 5 },
  btnTextSmall: { color: COLORS.primary, fontWeight: 'bold', fontSize: 10 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
  createModal: { backgroundColor: COLORS.secondary, padding: 20, borderRadius: 12, borderWidth: 1, borderColor: COLORS.blue },
  modalTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 15 },
  selectRowContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: COLORS.accent },
  rowLabel: { color: COLORS.textDark, fontSize: 16 },
  repsInput: { backgroundColor: COLORS.primary, color: COLORS.white, width: 50, padding: 5, borderRadius: 4, textAlign: 'center', borderWidth: 1, borderColor: COLORS.blue, marginRight: 10 },
  checkboxBtn: { padding: 5, borderRadius: 4, borderWidth: 1, borderColor: COLORS.blue },
  checkboxActive: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
  addCustomBtn: { backgroundColor: COLORS.blue, padding: 10, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  cancelBtn: { flex: 1, padding: 15, alignItems: 'center', marginRight: 10 },
  saveBtn: { flex: 1, backgroundColor: COLORS.blue, padding: 15, alignItems: 'center', borderRadius: 6 },
  btnText: { color: COLORS.text, fontWeight: 'bold' },
  settingsSaveBtn: { backgroundColor: COLORS.blue, padding: 18, borderRadius: 8, alignItems: 'center', marginTop: 30 },
  settingsSaveBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },
  settingsAvatar: { width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: COLORS.blue, marginBottom: 10 },
  editIconBadge: { position: 'absolute', bottom: 10, right: 10, backgroundColor: COLORS.blue, width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: COLORS.secondary },
  statBoxLarge: { backgroundColor: COLORS.accent, padding: 20, alignItems: 'center', borderRadius: 12, marginTop: 20 },
  bigStat: { color: COLORS.blue, fontSize: 40, fontWeight: 'bold' },
  bigStatLbl: { color: COLORS.textDark, fontSize: 12, letterSpacing: 2 },
  questPaperDark: { backgroundColor: COLORS.secondary, margin: 20, padding: 20, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent },
  questTitleDark: { color: COLORS.text, fontSize: 20, fontWeight: 'bold', textAlign: 'center' },
  difficulty: { color: COLORS.gold, textAlign: 'center', fontSize: 12, marginBottom: 10 },
  objTitleDark: { color: COLORS.blue, fontWeight: 'bold', marginTop: 10 },
  objRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  objTextDark: { color: COLORS.text },
  objValDark: { color: COLORS.text, fontWeight: 'bold' },
  divider: { height: 1, backgroundColor: COLORS.accent, marginVertical: 10 },
  rewardTitleDark: { color: COLORS.text, fontWeight: 'bold' },
  rewardText: { color: COLORS.blue, fontWeight: 'bold' },
  acceptBtn: { backgroundColor: COLORS.blue, margin: 20, padding: 15, borderRadius: 8, alignItems: 'center' },
  acceptBtnText: { color: COLORS.primary, fontWeight: 'bold', letterSpacing: 2 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: COLORS.accent, alignItems: 'center' },
  settingText: { color: COLORS.text, fontSize: 16 },
  alertBox: { backgroundColor: COLORS.secondary, borderRadius: 12, borderWidth: 2, borderColor: COLORS.blue, padding: 20, width: '100%' },
  alertTitle: { color: COLORS.blue, fontSize: 18, fontWeight: 'bold', textAlign: 'center', letterSpacing: 1 },
  alertMessage: { color: COLORS.text, textAlign: 'center', marginVertical: 15 },
  alertButtons: { flexDirection: 'row', justifyContent: 'center', marginTop: 10 },
  alertButton: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 6, minWidth: 80, alignItems: 'center', marginHorizontal: 5 },
  alertButtonDefault: { backgroundColor: COLORS.blue },
  alertButtonDestructive: { backgroundColor: COLORS.danger },
  alertButtonCancel: { backgroundColor: COLORS.accent },
  alertButtonText: { color: COLORS.text, fontWeight: 'bold', fontSize: 12 },
  timerCircle: { width: 120, height: 120, borderRadius: 60, borderWidth: 4, borderColor: COLORS.blue, justifyContent: 'center', alignItems: 'center', marginVertical: 30 },
  timerText: { fontSize: 40, fontWeight: 'bold', color: COLORS.white },
  dayBtn: { width: 35, height: 35, borderRadius: 17.5, backgroundColor: COLORS.secondary, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.accent },
  dayBtnActive: { backgroundColor: COLORS.blue, borderColor: COLORS.glow },
  dayBtnText: { color: COLORS.textDark, fontSize: 12, fontWeight: 'bold' },
});






// import React, { useState, useEffect, useRef } from 'react';
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   ScrollView,
//   TextInput,
//   Animated,
//   Dimensions,
//   StatusBar,
//   Modal,
//   Image,
//   Vibration,
//   Platform,
//   BackHandler, // Added BackHandler
// } from 'react-native';
// import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
// import AsyncStorage from '@react-native-async-storage/async-storage';
// import { CameraView, useCameraPermissions } from 'expo-camera'; // Kept File 1's CameraView
// import { LineChart } from 'react-native-chart-kit';
// import { Audio } from 'expo-av'; // Switched to expo-av for background support
// import * as DocumentPicker from 'expo-document-picker';
// import * as ImagePicker from 'expo-image-picker';
// import Slider from '@react-native-community/slider';
// import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';

// const { width, height } = Dimensions.get('window');

// // --- Type Definitions ---
// type GoalType = 'muscle' | 'weight_loss' | 'speed_strength';

// interface UserData {
//   name: string;
//   level: number;
//   sex: 'male' | 'female';
//   weight: number;
//   height: number;
//   goal: GoalType; 
//   xp: number;
//   totalWorkouts: number;
//   createdAt: string;
//   lastDailyQuestCompleted?: string; // ISO Date only YYYY-MM-DD
//   cameraEnabled: boolean;
//   profileImage?: string;
//   assessmentStats?: { [key: string]: number };
// }

// interface Exercise {
//   name: string;
//   iconName: string;
//   iconLib: 'Ionicons' | 'MaterialCommunityIcons' | 'FontAwesome5';
//   type?: 'reps' | 'duration' | 'distance';
//   custom?: boolean;
// }

// interface ExerciseConfig {
//   [key: string]: Exercise;
// }

// interface Quest {
//   title: string;
//   difficulty: number;
//   exercises: { [key: string]: number };
//   rewards: {
//     xp: number;
//     title: string;
//   };
//   customExercises?: ExerciseConfig;
//   isDaily?: boolean; // To track if this is the daily requirement
// }

// interface TrainingResult {
//   [key: string]: number;
// }

// interface TrainingHistory {
//   date: string;
//   quest: Quest;
//   results: TrainingResult;
//   xpGained: number;
//   durationSeconds?: number;
// }

// interface MusicTrack {
//   id: string;
//   title: string;
//   path: any; // require() or uri string
//   isLocal: boolean;
//   isFavorite: boolean;
//   artwork?: string;
// }

// interface CustomProgram {
//   id: string;
//   name: string;
//   exercises: { [key: string]: number };
//   customExercises?: ExerciseConfig;
//   schedule: string[]; // ['Mon', 'Wed', etc.]
//   createdAt: string;
// }

// interface AlertButton {
//   text: string;
//   onPress?: () => void;
//   style?: 'default' | 'cancel' | 'destructive';
// }

// interface CustomAlertState {
//   visible: boolean;
//   title: string;
//   message: string;
//   buttons: AlertButton[];
// }

// type PlaybackMode = 'loop_all' | 'play_all' | 'loop_one' | 'play_one';

// // --- Theme ---
// const COLORS = {
//   primary: '#050714',     
//   secondary: '#0F172A',   
//   accent: '#1E293B',      
//   highlight: '#2563EB',   
//   blue: '#3B82F6',        
//   lightBlue: '#60A5FA',
//   purple: '#7C3AED',      
//   danger: '#EF4444',
//   success: '#10B981',
//   text: '#F8FAFC',
//   textDark: '#94A3B8',
//   glow: '#0EA5E9',
//   gold: '#F59E0B',
//   white: '#FFFFFF',
// };

// // --- Constants ---
// const XP_PER_LEVEL_BASE = 600; 
// const PENALTY_XP = 100;
// const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// const EXERCISES: ExerciseConfig = {
//   // Standard
//   squats: { name: 'Squats', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   pushups: { name: 'Push-ups', iconName: 'human-handsup', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   situps: { name: 'Sit-ups', iconName: 'dumbbell', iconLib: 'FontAwesome5', type: 'reps' },
//   pullups: { name: 'Pull-ups', iconName: 'human-male-height', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   bicepCurls: { name: 'Bicep Curls', iconName: 'arm-flex', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   lunges: { name: 'Lunges', iconName: 'run', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   plank: { name: 'Plank (sec)', iconName: 'timer', iconLib: 'Ionicons', type: 'duration' },
//   running: { name: 'Running (km)', iconName: 'run-fast', iconLib: 'MaterialCommunityIcons', type: 'distance' },
  
//   // Dynamic / Speed & Strength
//   clapPushups: { name: 'Clap Push-ups', iconName: 'flash', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   jumpSquats: { name: 'Jump Squats', iconName: 'arrow-up-bold-circle', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   burpees: { name: 'Burpees', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
// };

// // --- Pose Detection Logic ---
// class PoseCalculator {
//   static calculateAngle(a: {x:number, y:number}, b: {x:number, y:number}, c: {x:number, y:number}) {
//     const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
//     let angle = Math.abs(radians * 180.0 / Math.PI);
//     if (angle > 180.0) angle = 360 - angle;
//     return angle;
//   }

//   static detectSquat(landmarks: any): { angle: number } {
//     return { angle: 0 }; 
//   }

//   static isSupported(exerciseKey: string): boolean {
//       const supported = ['squats', 'pushups', 'situps', 'bicepCurls', 'lifting'];
//       return supported.includes(exerciseKey);
//   }
// }

// // --- Sound System ---
// const SYSTEM_SOUND = require('../assets/audio/solo_leveling_system.mp3'); 
// const DEFAULT_OST = require('../assets/audio/ost.mp3');

// // --- Helper Functions ---
// const getDayString = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'short' });
// const getISODate = (date: Date) => date.toISOString().split('T')[0];

// // --- Helper Components ---
// const SoloIcon = ({ name, lib, size = 24, color = COLORS.text }: { name: string, lib: string, size?: number, color?: string }) => {
//   if (lib === 'Ionicons') return <Ionicons name={name as any} size={size} color={color} />;
//   if (lib === 'MaterialCommunityIcons') return <MaterialCommunityIcons name={name as any} size={size} color={color} />;
//   if (lib === 'FontAwesome5') return <FontAwesome5 name={name as any} size={size} color={color} />;
//   return null;
// };

// const CustomAlert = ({ visible, title, message, buttons, onClose }: { visible: boolean, title: string, message: string, buttons: AlertButton[], onClose: () => void }) => {
//   if (!visible) return null;
//   return (
//     <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
//       <View style={styles.modalOverlay}>
//         <View style={styles.alertBox}>
//           <Text style={styles.alertTitle}>{title}</Text>
//           <View style={styles.divider} />
//           <Text style={styles.alertMessage}>{message}</Text>
//           <View style={styles.alertButtons}>
//             {buttons.map((btn, index) => (
//               <TouchableOpacity
//                 key={index}
//                 style={[
//                   styles.alertButton,
//                   btn.style === 'destructive' ? styles.alertButtonDestructive : 
//                   btn.style === 'cancel' ? styles.alertButtonCancel : styles.alertButtonDefault
//                 ]}
//                 onPress={() => {
//                   if (btn.onPress) btn.onPress();
//                   onClose();
//                 }}
//               >
//                 <Text style={styles.alertButtonText}>{btn.text}</Text>
//               </TouchableOpacity>
//             ))}
//           </View>
//         </View>
//       </View>
//     </Modal>
//   );
// };

// // --- Main App ---
// export default function SoloLevelingFitnessTracker(): JSX.Element {
//   // Global State
//   const [screen, setScreenState] = useState<string>('loading');
//   const [userData, setUserData] = useState<UserData | null>(null);
//   const [customPrograms, setCustomPrograms] = useState<CustomProgram[]>([]);
  
//   // Alert State
//   const [alertState, setAlertState] = useState<CustomAlertState>({
//     visible: false, title: '', message: '', buttons: [],
//   });

//   // Music Player State (Updated to expo-av for background playback)
//   const [playlist, setPlaylist] = useState<MusicTrack[]>([]);
//   const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
//   const [sound, setSound] = useState<Audio.Sound | null>(null); // Changed to Sound object
//   const [isPlaying, setIsPlaying] = useState(false);
//   const [musicLoading, setMusicLoading] = useState(false); 
//   const [position, setPosition] = useState(0);
//   const [duration, setDuration] = useState(0);
//   const [isMuted, setIsMuted] = useState(false);
//   const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('loop_all');
  
//   // Refs for logic to avoid stale closures
//   const playlistRef = useRef<MusicTrack[]>([]);
//   const currentTrackRef = useRef<MusicTrack | null>(null);
//   const playbackModeRef = useRef<PlaybackMode>('loop_all');

//   useEffect(() => { playlistRef.current = playlist; }, [playlist]);
//   useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
//   useEffect(() => { playbackModeRef.current = playbackMode; }, [playbackMode]);

//   // System Sound State
//   const [systemSoundObj, setSystemSoundObj] = useState<Audio.Sound | null>(null);

//   // Training State
//   const [currentQuest, setCurrentQuest] = useState<Quest | null>(null);
//   const [isTraining, setIsTraining] = useState<boolean>(false);

//   // --- Audio System Logic ---

//   const playSystemSound = async () => {
//     try {
//       if (systemSoundObj) {
//         await systemSoundObj.unloadAsync();
//       }
//       // Ducking music volume manually if needed, though expo-av ducking handles some of this
//       if (sound && isPlaying) {
//         await sound.setVolumeAsync(0.1); 
//       }

//       const { sound: newSysSound } = await Audio.Sound.createAsync(SYSTEM_SOUND);
//       setSystemSoundObj(newSysSound);
//       await newSysSound.playAsync();

//       newSysSound.setOnPlaybackStatusUpdate(async (status) => {
//         if (status.isLoaded && status.didJustFinish) {
//             await newSysSound.unloadAsync();
//             setSystemSoundObj(null);
//             // Restore music volume
//             if (sound && isPlaying) await sound.setVolumeAsync(1.0);
//         }
//       });
//     } catch (error) { console.log('System sound error', error); }
//   };

//   const navigateTo = (newScreen: string) => {
//     if (newScreen !== screen) {
//       playSystemSound();
//       setScreenState(newScreen);
//     }
//   };

//   const showAlert = (title: string, message: string, buttons: AlertButton[] = [{ text: 'OK' }]) => {
//     setAlertState({ visible: true, title, message, buttons });
//   };

//   const closeAlert = () => {
//     setAlertState(prev => ({ ...prev, visible: false }));
//   };

//   // --- Hardware Back Button Handler ---
//   useEffect(() => {
//     const backAction = () => {
//       // If we are on main screens, let default exit behavior happen
//       if (screen === 'dashboard' || screen === 'loading' || screen === 'setup') {
//         return false;
//       }
      
//       // If in training, show confirmation alert instead of just going back
//       if (screen === 'training') {
//         showAlert("Abort Mission?", "Stop training?", [
//           { text: "Cancel", style: "cancel" }, 
//           { text: "Quit", style: "destructive", onPress: () => navigateTo('dashboard') }
//         ]);
//         return true; // Prevent default behavior
//       }

//       // For all other screens, navigate back to dashboard
//       navigateTo('dashboard');
//       return true; // Prevent default behavior
//     };

//     const backHandler = BackHandler.addEventListener(
//       'hardwareBackPress',
//       backAction
//     );

//     return () => backHandler.remove();
//   }, [screen]); // Re-bind when screen changes to capture correct state

//   // --- Initialization & Penalty System ---
//   useEffect(() => {
//     async function init() {
//       // 1. Configure Background Audio (Crucial for background playback)
//       try {
//         await Audio.setAudioModeAsync({
//           allowsRecordingIOS: false,
//           staysActiveInBackground: true, // Key for background audio
//           playsInSilentModeIOS: true,
//           shouldDuckAndroid: true,
//           playThroughEarpieceAndroid: false,
//         });
//       } catch (e) {
//         console.warn("Audio Mode Config Error:", e);
//       }

//       // Load Music
//       try {
//         const stored = await AsyncStorage.getItem('musicPlaylist');
//         const defaultTrack: MusicTrack = { id: 'default_ost', title: 'System Soundtrack (Default)', path: DEFAULT_OST, isLocal: true, isFavorite: true };
//         let tracks: MusicTrack[] = [defaultTrack];
//         if (stored) {
//           const parsed = JSON.parse(stored);
//           const userTracks = parsed.filter((t: MusicTrack) => t.id !== 'default_ost');
//           tracks = [...tracks, ...userTracks];
//         }
//         setPlaylist(tracks);
//       } catch (e) { console.error("Audio Init Error", e); }

//       playSystemSound();
      
//       // Load Data
//       const progData = await AsyncStorage.getItem('customPrograms');
//       const loadedPrograms: CustomProgram[] = progData ? JSON.parse(progData) : [];
//       setCustomPrograms(loadedPrograms);

//       const data = await AsyncStorage.getItem('userData');
//       if (data) {
//         let user: UserData = JSON.parse(data);
//         user = await checkPenalties(user, loadedPrograms); // Check for missed quests
//         setUserData(user);
//         setScreenState('dashboard');
//       } else {
//         setScreenState('setup');
//       }
//     }
//     init();

//     return () => {
//       if (sound) sound.unloadAsync();
//       if (systemSoundObj) systemSoundObj.unloadAsync();
//     };
//   }, []);

//   const checkPenalties = async (user: UserData, programs: CustomProgram[]): Promise<UserData> => {
//     if (!user.lastDailyQuestCompleted) {
//         const yesterday = new Date();
//         yesterday.setDate(yesterday.getDate() - 1);
//         user.lastDailyQuestCompleted = getISODate(yesterday);
//         await AsyncStorage.setItem('userData', JSON.stringify(user));
//         return user;
//     }

//     const lastDate = new Date(user.lastDailyQuestCompleted);
//     const today = new Date();
//     const todayStr = getISODate(today);
    
//     if (user.lastDailyQuestCompleted === todayStr) return user;

//     let penaltyXP = 0;
//     let missedDays = 0;
    
//     const checkDate = new Date(lastDate);
//     checkDate.setDate(checkDate.getDate() + 1);

//     while (getISODate(checkDate) < todayStr) {
//         penaltyXP += PENALTY_XP;
//         missedDays++;
//         checkDate.setDate(checkDate.getDate() + 1);
//     }

//     if (penaltyXP > 0) {
//         let newXP = user.xp - penaltyXP;
//         let newLevel = user.level;

//         while (newXP < 0) {
//             if (newLevel > 1) {
//                 newLevel--;
//                 const xpForPrevLevel = newLevel * XP_PER_LEVEL_BASE;
//                 newXP = xpForPrevLevel + newXP;
//             } else {
//                 newXP = 0;
//                 break;
//             }
//         }

//         user.xp = newXP;
//         user.level = newLevel;

//         showAlert(
//           "PENALTY SYSTEM", 
//           `You failed to complete daily quests for ${missedDays} day(s).\n\nPUNISHMENT: -${penaltyXP} XP.\n${user.level < (JSON.parse(await AsyncStorage.getItem('userData') || '{}').level || user.level) ? 'YOUR LEVEL HAS DECREASED.' : ''}`
//         );
        
//         await AsyncStorage.setItem('userData', JSON.stringify(user));
//     }

//     return user;
//   };

//   // UI Updater for Music Slider
//   useEffect(() => {
//     let interval: NodeJS.Timeout;
//     if (sound && isPlaying) {
//       interval = setInterval(async () => {
//         try {
//             const status = await sound.getStatusAsync();
//             if (status.isLoaded) {
//                 setPosition(status.positionMillis / 1000);
//                 setDuration(status.durationMillis ? status.durationMillis / 1000 : 1);
//             }
//         } catch (e) {}
//       }, 1000);
//     }
//     return () => clearInterval(interval);
//   }, [sound, isPlaying]);

//   const handleAutoNext = async (currentSound: Audio.Sound) => {
//     const list = playlistRef.current;
//     const curr = currentTrackRef.current;
//     const mode = playbackModeRef.current;

//     if (!curr || list.length === 0) return;

//     if (mode === 'loop_one') {
//       await currentSound.replayAsync();
//     } 
//     else if (mode === 'play_one') {
//       setIsPlaying(false); setPosition(0);
//       await currentSound.stopAsync();
//       await currentSound.setPositionAsync(0);
//     } 
//     else if (mode === 'play_all') {
//       const idx = list.findIndex(t => t.id === curr.id);
//       if (idx !== -1 && idx < list.length - 1) {
//         playTrack(list[idx + 1]);
//       } else {
//         setIsPlaying(false); setPosition(0);
//         await currentSound.stopAsync();
//         await currentSound.setPositionAsync(0);
//       }
//     } 
//     else if (mode === 'loop_all') {
//       const idx = list.findIndex(t => t.id === curr.id);
//       const nextIdx = (idx + 1) % list.length;
//       playTrack(list[nextIdx]);
//     }
//   };

//   const saveUserData = async (data: UserData) => {
//     await AsyncStorage.setItem('userData', JSON.stringify(data));
//     setUserData(data);
//   };

//   const updateCustomPrograms = async (programs: CustomProgram[]) => {
//       setCustomPrograms(programs);
//       await AsyncStorage.setItem('customPrograms', JSON.stringify(programs));
//   };

//   // --- Music Controls ---
//   const playTrack = async (track: MusicTrack) => {
//     if (musicLoading) return;
    
//     // Prevent re-creating player if user taps the playing song
//     if (currentTrack?.id === track.id && sound) {
//         const status = await sound.getStatusAsync();
//         if(status.isLoaded && !status.isPlaying) {
//              await sound.playAsync();
//              setIsPlaying(true);
//              return;
//         }
//     }

//     try {
//       setMusicLoading(true);
      
//       // Release old player safely
//       if (sound) { 
//           await sound.unloadAsync();
//           setSound(null);
//       }

//       const source = track.isLocal ? track.path : { uri: track.path };
//       const mode = playbackModeRef.current;
//       const shouldLoop = mode === 'loop_one';
      
//       const { sound: newSound } = await Audio.Sound.createAsync(
//           source,
//           { shouldPlay: true, isLooping: shouldLoop }
//       );

//       newSound.setOnPlaybackStatusUpdate((status) => {
//          if (status.isLoaded && status.didJustFinish && !status.isLooping) {
//             handleAutoNext(newSound);
//          }
//       });

//       if (isMuted) await newSound.setIsMutedAsync(true);

//       setSound(newSound); 
//       setCurrentTrack(track); 
//       setIsPlaying(true);
      
//       setMusicLoading(false);
//     } catch (error) {
//       console.log('Play Error', error);
//       setMusicLoading(false);
//       showAlert('Error', 'Could not play audio track.');
//     }
//   };

//   const togglePlayPause = async () => {
//     if (!sound) { 
//         if (playlist.length > 0) playTrack(playlist[0]); 
//         return; 
//     }
//     if (musicLoading) return;
    
//     if (isPlaying) { 
//         await sound.pauseAsync(); 
//         setIsPlaying(false); 
//     } else { 
//         await sound.playAsync(); 
//         setIsPlaying(true); 
//     }
//   };

//   const seekTrack = async (value: number) => {
//     if (sound && !musicLoading) { 
//         await sound.setPositionAsync(value * 1000);
//         setPosition(value); 
//     }
//   };

//   const skipToNext = () => {
//     if (!currentTrack || playlist.length === 0) return;
//     const idx = playlist.findIndex(t => t.id === currentTrack.id);
//     const nextIdx = (idx + 1) % playlist.length;
//     playTrack(playlist[nextIdx]);
//   };

//   const skipToPrev = () => {
//     if (!currentTrack || playlist.length === 0) return;
//     const idx = playlist.findIndex(t => t.id === currentTrack.id);
//     const prevIdx = idx === 0 ? playlist.length - 1 : idx - 1;
//     playTrack(playlist[prevIdx]);
//   };

//   const deleteTrack = async (trackId: string) => {
//     if (trackId === 'default_ost') return;
//     if (currentTrack?.id === trackId) { 
//         if (sound) await sound.unloadAsync();
//         setSound(null);
//         setCurrentTrack(null);
//         setIsPlaying(false); 
//     }
//     const newList = playlist.filter(t => t.id !== trackId);
//     setPlaylist(newList);
//     AsyncStorage.setItem('musicPlaylist', JSON.stringify(newList));
//   };

//   const addMusicFile = async () => {
//     try {
//       const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
//       if (!result.canceled && result.assets && result.assets.length > 0) {
//         const file = result.assets[0];
//         const newTrack: MusicTrack = { id: Date.now().toString(), title: file.name, path: file.uri, isLocal: false, isFavorite: false };
//         const newList = [...playlist, newTrack];
//         setPlaylist(newList);
//         AsyncStorage.setItem('musicPlaylist', JSON.stringify(newList));
//       }
//     } catch (e) { showAlert('Error', 'Failed to pick audio file'); }
//   };

//   // --- Mini Player ---
//   const MiniPlayer = () => {
//     if (!currentTrack) return null;
//     return (
//       <TouchableOpacity activeOpacity={0.9} onPress={() => navigateTo('music')} style={styles.miniPlayerContainer}>
//          <View style={styles.miniProgressContainer}><View style={[styles.miniProgressFill, { width: `${(position / (duration || 1)) * 100}%` }]} /></View>
//          <View style={styles.miniPlayerContent}>
//             <View style={styles.miniInfo}>
//                {currentTrack.artwork ? ( <Image source={{ uri: currentTrack.artwork }} style={styles.miniArt} /> ) : ( <Ionicons name="musical-note" size={20} color={COLORS.blue} style={{marginRight: 10}} /> )}
//                <View><Text style={styles.miniTitle} numberOfLines={1}>{currentTrack.title}</Text><Text style={styles.miniTime}>{formatTime(position)} / {formatTime(duration)}</Text></View>
//             </View>
//             <View style={styles.miniControls}>
//                <TouchableOpacity onPress={(e) => { e.stopPropagation(); skipToPrev(); }} style={styles.miniCtrlBtn}><Ionicons name="play-skip-back" size={20} color={COLORS.text} /></TouchableOpacity>
//                <TouchableOpacity onPress={(e) => { e.stopPropagation(); togglePlayPause(); }} style={styles.miniCtrlBtn}><Ionicons name={isPlaying ? "pause" : "play"} size={26} color={COLORS.white} /></TouchableOpacity>
//                <TouchableOpacity onPress={(e) => { e.stopPropagation(); skipToNext(); }} style={styles.miniCtrlBtn}><Ionicons name="play-skip-forward" size={20} color={COLORS.text} /></TouchableOpacity>
//             </View>
//          </View>
//       </TouchableOpacity>
//     );
//   };

//   // --- Render Current Screen ---
//   const renderScreen = () => {
//     if (!userData && screen !== 'loading' && screen !== 'setup') return <LoadingScreen />;

//     switch (screen) {
//       case 'loading': return <LoadingScreen />;
//       case 'setup': 
//         return <SetupScreen onComplete={(data) => { setUserData(data); setScreenState('assessment'); }} />;
//       case 'assessment':
//         return <AssessmentScreen userData={userData!} onComplete={(stats, calculatedLevel) => {
//             const finalData = { ...userData!, level: calculatedLevel, assessmentStats: stats, createdAt: new Date().toISOString(), lastDailyQuestCompleted: getISODate(new Date()) };
//             saveUserData(finalData);
//             navigateTo('dashboard');
//         }} />;
//       case 'dashboard': 
//         return <DashboardScreen userData={userData!} onNavigate={navigateTo} onStartQuest={() => navigateTo('quest')} />;
//       case 'quest': 
//         return <QuestScreen 
//           userData={userData!} 
//           customPrograms={customPrograms}
//           onBack={() => navigateTo('dashboard')}
//           onStartTraining={(quest) => { setCurrentQuest(quest); setIsTraining(true); navigateTo('training'); }}
//         />;
//       case 'training':
//         return <TrainingScreen 
//           userData={userData!} 
//           quest={currentQuest!} 
//           showAlert={showAlert} // Passing alert handler
//           onComplete={(results, duration) => { updateProgress(results, duration); navigateTo('dashboard'); }}
//           onBack={() => { 
//             showAlert("Abort Mission?", "Stop training?", [
//               { text: "Cancel", style: "cancel" }, 
//               { text: "Quit", style: "destructive", onPress: () => navigateTo('dashboard') }
//             ]); 
//           }}
//         />;
//       case 'stats': return <StatsScreen userData={userData!} onBack={() => navigateTo('dashboard')} />;
//       case 'music': return <MusicScreen 
//           playlist={playlist} currentTrack={currentTrack} isPlaying={isPlaying} isLoading={musicLoading}
//           position={position} duration={duration} playbackMode={playbackMode}
//           onPlay={playTrack} onPause={togglePlayPause} onSeek={seekTrack} onNext={skipToNext} onPrev={skipToPrev} onDelete={deleteTrack} onAdd={addMusicFile}
//           onToggleMode={async () => {
//             const modes: PlaybackMode[] = ['loop_all', 'play_all', 'loop_one', 'play_one'];
//             const nextMode = modes[(modes.indexOf(playbackMode) + 1) % modes.length];
//             setPlaybackMode(nextMode);
//             // Sync current player native loop property
//             if(sound) await sound.setIsLoopingAsync(nextMode === 'loop_one');
//           }}
//           onBack={() => navigateTo('dashboard')} 
//         />;
//       case 'programs': return <CustomProgramsScreen 
//           userData={userData!} 
//           customPrograms={customPrograms}
//           setCustomPrograms={updateCustomPrograms}
//           onBack={() => navigateTo('dashboard')} 
//           onStartProgram={(quest) => { setCurrentQuest(quest); setIsTraining(true); navigateTo('training'); }}
//           showAlert={showAlert}
//         />;
//       case 'settings': return <SettingsScreen userData={userData!} onSave={(data) => { saveUserData(data); navigateTo('dashboard'); }} onBack={() => navigateTo('dashboard')} />;
//       default: return <LoadingScreen />;
//     }
//   };

//   const updateProgress = async (results: TrainingResult, duration: number) => {
//     try {
//       let xpGained = 0;
//       if (currentQuest?.isDaily) {
//           xpGained = currentQuest.rewards.xp;
//           const todayStr = getISODate(new Date());
//           userData!.lastDailyQuestCompleted = todayStr;
//       } else {
//           xpGained = 100;
//       }

//       const history = await AsyncStorage.getItem('trainingHistory');
//       const parsed: TrainingHistory[] = history ? JSON.parse(history) : [];
//       const newEntry: TrainingHistory = { date: new Date().toISOString(), quest: currentQuest!, results: results, xpGained: xpGained, durationSeconds: duration };
//       parsed.push(newEntry);
//       await AsyncStorage.setItem('trainingHistory', JSON.stringify(parsed));

//       const xpNeeded = userData!.level * XP_PER_LEVEL_BASE;
//       let newTotalXP = userData!.xp + xpGained;
//       let newLevel = userData!.level;
//       let leveledUp = false;

//       while (newTotalXP >= xpNeeded) {
//         newTotalXP -= xpNeeded;
//         newLevel++;
//         leveledUp = true;
//       }

//       const newUserData: UserData = {
//         ...userData!, xp: newTotalXP, level: newLevel, totalWorkouts: (userData!.totalWorkouts || 0) + 1,
//       };
      
//       if (leveledUp) {
//         showAlert('LEVEL UP!', `You have reached Level ${newLevel}!`);
//       } else {
//         showAlert('QUEST COMPLETED', `You gained ${xpGained} Experience Points.`);
//       }
//       saveUserData(newUserData);
//     } catch (error) { console.error('Error updating progress:', error); }
//   };

//   // return (
//   //   <SafeAreaProvider>
//   //       <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
//   //       <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} translucent={false} />
//   //       <View style={{ flex: 1, paddingBottom: (currentTrack && screen !== 'music') ? 70 : 0 }}>{renderScreen()}</View>
//   //       {currentTrack && screen !== 'music' && <MiniPlayer />}
//   //       <CustomAlert visible={alertState.visible} title={alertState.title} message={alertState.message} buttons={alertState.buttons} onClose={closeAlert} />
//   //       </SafeAreaView>
//   //   </SafeAreaProvider>
//   // );
//   return (
//   <SafeAreaProvider>
//     <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
//       <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} translucent={false} />
      
//       {/* Main content - takes remaining space */}
//       <View style={{ flex: 1 }}>
//         {renderScreen()}
//       </View>
      
//       {/* Mini player - natural bottom position */}
//       {currentTrack && screen !== 'music' && <MiniPlayer />}
      
//       <CustomAlert {...alertState} onClose={closeAlert} />
//     </SafeAreaView>
//   </SafeAreaProvider>
// );
// }

// // --- Screens ---

// function LoadingScreen() {
//   const spinValue = useRef(new Animated.Value(0)).current;
//   useEffect(() => { Animated.loop(Animated.timing(spinValue, { toValue: 1, duration: 2000, useNativeDriver: true })).start(); }, []);
//   const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
//   return (
//     <View style={styles.centerContainer}>
//       <Animated.View style={{ transform: [{ rotate: spin }], marginBottom: 20 }}><Ionicons name="reload-circle-outline" size={60} color={COLORS.blue} /></Animated.View>
//       <Text style={styles.loadingTitle}>SOLO LEVELING</Text><Text style={styles.loadingSubtitle}>INITIALIZING SYSTEM...</Text>
//     </View>
//   );
// }

// function SetupScreen({ onComplete }: { onComplete: (data: UserData) => void }) {
//   const [formData, setFormData] = useState<any>({ name: '', level: 1, sex: 'male', weight: '', height: '', goal: 'muscle' });
//   const [image, setImage] = useState<string | null>(null);
//   const pickImage = async () => {
//     let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5 });
//     if (!result.canceled) setImage(result.assets[0].uri);
//   };
//   const handleNext = () => {
//     if (!formData.name) return;
//     onComplete({ ...formData, weight: parseFloat(formData.weight) || 70, height: parseFloat(formData.height) || 170, xp: 0, totalWorkouts: 0, createdAt: new Date().toISOString(), cameraEnabled: false, profileImage: image || undefined });
//   };
//   const GoalButton = ({ type, icon, label }: { type: GoalType, icon: string, label: string }) => (
//     <TouchableOpacity style={[styles.goalBtn, formData.goal === type && styles.goalBtnActive]} onPress={() => setFormData({...formData, goal: type})}>
//         <MaterialCommunityIcons name={icon as any} size={24} color={formData.goal === type ? COLORS.white : COLORS.blue} />
//         <Text style={formData.goal === type ? styles.goalTextActive : styles.goalText}>{label}</Text>
//     </TouchableOpacity>
//   );
//   return (
//     <ScrollView style={styles.screenContainer} contentContainerStyle={{padding: 20}} showsVerticalScrollIndicator={false}>
//       <Text style={styles.headerTitle}>PLAYER REGISTRATION</Text>
//       <TouchableOpacity onPress={pickImage} style={styles.avatarPicker}>
//         {image ? ( <Image source={{ uri: image }} style={styles.avatarImage} /> ) : ( <View style={styles.avatarPlaceholder}><Ionicons name="camera" size={40} color={COLORS.textDark} /><Text style={styles.avatarText}>ADD PHOTO</Text></View> )}
//       </TouchableOpacity>
//       <View style={styles.formGroup}><Text style={styles.label}>HUNTER NAME</Text><TextInput style={styles.input} placeholder="Enter Name" placeholderTextColor={COLORS.textDark} onChangeText={t => setFormData({...formData, name: t})} /></View>
//       <View style={styles.formGroup}><Text style={styles.label}>GOAL / CLASS</Text><GoalButton type="muscle" icon="arm-flex" label="Muscle & Strength" /><GoalButton type="weight_loss" icon="run-fast" label="Weight Loss" /><GoalButton type="speed_strength" icon="flash" label="Speed & Strength (Assassin)" /></View>
//       <View style={styles.formGroup}><Text style={styles.label}>GENDER</Text><View style={styles.genderContainer}><TouchableOpacity style={[styles.genderBtn, formData.sex === 'male' && styles.genderBtnActive]} onPress={() => setFormData({...formData, sex: 'male'})}><Ionicons name="male" size={20} color={formData.sex === 'male' ? COLORS.white : COLORS.blue} /><Text style={formData.sex === 'male' ? styles.genderTextActive : styles.genderText}>MALE</Text></TouchableOpacity><TouchableOpacity style={[styles.genderBtn, formData.sex === 'female' && styles.genderBtnActive]} onPress={() => setFormData({...formData, sex: 'female'})}><Ionicons name="female" size={20} color={formData.sex === 'female' ? COLORS.white : COLORS.blue} /><Text style={formData.sex === 'female' ? styles.genderTextActive : styles.genderText}>FEMALE</Text></TouchableOpacity></View></View>
//       <View style={styles.row}><View style={[styles.formGroup, {flex:1, marginRight: 10}]}><Text style={styles.label}>WEIGHT (KG)</Text><TextInput style={styles.input} keyboardType="numeric" onChangeText={t => setFormData({...formData, weight: t})} /></View><View style={[styles.formGroup, {flex:1}]}><Text style={styles.label}>HEIGHT (CM)</Text><TextInput style={styles.input} keyboardType="numeric" onChangeText={t => setFormData({...formData, height: t})} /></View></View>
//       <TouchableOpacity style={styles.mainButton} onPress={handleNext}><Text style={styles.mainButtonText}>PROCEED TO EVALUATION</Text></TouchableOpacity>
//     </ScrollView>
//   );
// }

// function AssessmentScreen({ userData, onComplete }: { userData: UserData, onComplete: (stats: any, level: number) => void }) {
//     const [step, setStep] = useState<'intro' | 'active' | 'rest' | 'input'>('intro');
//     const [currentExIndex, setCurrentExIndex] = useState(0);
//     const [timer, setTimer] = useState(0);
//     const [reps, setReps] = useState('');
//     const [results, setResults] = useState<{[key:string]: number}>({});

//     const getExercises = () => {
//         if (userData.goal === 'speed_strength') return ['pushups', 'jumpSquats', 'lunges']; 
//         else if (userData.goal === 'weight_loss') return ['squats', 'situps', 'lunges']; 
//         else return ['pushups', 'squats', 'situps']; 
//     };

//     const exercises = getExercises();
//     const currentEx = exercises[currentExIndex];
//     const EX_TIME = 60; const REST_TIME = 15;

//     useEffect(() => {
//         let interval: NodeJS.Timeout;
//         if ((step === 'active' || step === 'rest') && timer > 0) {
//             interval = setInterval(() => {
//                 setTimer(prev => {
//                     if (prev <= 1) {
//                         if (step === 'active') { Vibration.vibrate(); setStep('input'); } 
//                         else if (step === 'rest') {
//                             if (currentExIndex < exercises.length - 1) { setCurrentExIndex(prevIdx => prevIdx + 1); startExercise(); } 
//                             else { finishAssessment(); }
//                         }
//                         return 0;
//                     }
//                     return prev - 1;
//                 });
//             }, 1000);
//         }
//         return () => clearInterval(interval);
//     }, [step, timer]);

//     const startExercise = () => { setTimer(EX_TIME); setStep('active'); setReps(''); };
//     const handleInput = () => {
//         const count = parseInt(reps) || 0;
//         setResults(prev => ({...prev, [currentEx]: count}));
//         if (currentExIndex < exercises.length - 1) { setTimer(REST_TIME); setStep('rest'); } 
//         else { finishAssessment(count); }
//     };

//     const finishAssessment = (lastReps?: number) => {
//         const finalResults = lastReps ? {...results, [currentEx]: lastReps} : results;
//         let totalReps = 0; Object.values(finalResults).forEach(val => totalReps += val);
//         const calculatedLevel = Math.max(1, Math.floor(totalReps / 40) + 1);
//         onComplete(finalResults, calculatedLevel);
//     };

//     return (
//         <View style={styles.centerContainer}>
//             <Text style={styles.headerTitle}>SYSTEM EVALUATION</Text>
//             {step === 'intro' && (
//                 <View style={{padding: 20, alignItems: 'center'}}>
//                     <Text style={styles.questTitleDark}>RANKING TEST</Text>
//                     <Text style={styles.alertMessage}>You will perform 3 exercises to determine your Hunter Rank. {"\n\n"}1 Minute MAX reps for each.{"\n"}15 Seconds rest between sets.</Text>
//                     {exercises.map(e => ( <View key={e} style={{flexDirection:'row', marginVertical: 5}}><SoloIcon name={EXERCISES[e].iconName} lib={EXERCISES[e].iconLib} color={COLORS.blue} /><Text style={{color: COLORS.text, marginLeft: 10}}>{EXERCISES[e].name}</Text></View> ))}
//                     <TouchableOpacity style={styles.mainButton} onPress={startExercise}><Text style={styles.mainButtonText}>START TEST</Text></TouchableOpacity>
//                 </View>
//             )}
//             {step === 'active' && (
//                 <View style={{alignItems: 'center'}}>
//                     <Text style={styles.loadingSubtitle}>CURRENT EXERCISE</Text><Text style={styles.loadingTitle}>{EXERCISES[currentEx].name}</Text>
//                     <View style={styles.timerCircle}><Text style={styles.timerText}>{timer}</Text></View><Text style={styles.label}>DO AS MANY AS YOU CAN</Text>
//                 </View>
//             )}
//             {step === 'input' && (
//                 <View style={{alignItems: 'center', width: '80%'}}>
//                     <Text style={styles.questTitleDark}>TIME'S UP</Text><Text style={styles.label}>ENTER REPS COMPLETED:</Text>
//                     <TextInput style={[styles.input, {textAlign: 'center', fontSize: 24, width: 100}]} keyboardType="numeric" value={reps} onChangeText={setReps} autoFocus />
//                     <TouchableOpacity style={styles.mainButton} onPress={handleInput}><Text style={styles.mainButtonText}>CONFIRM</Text></TouchableOpacity>
//                 </View>
//             )}
//             {step === 'rest' && (
//                 <View style={{alignItems: 'center'}}>
//                     <Text style={styles.loadingTitle}>REST</Text><Text style={styles.timerText}>{timer}</Text><Text style={styles.loadingSubtitle}>NEXT: {EXERCISES[exercises[currentExIndex + 1]]?.name}</Text>
//                 </View>
//             )}
//         </View>
//     );
// }

// function DashboardScreen({ userData, onNavigate, onStartQuest }: any) {
//   if (!userData) return null;
//   const xpPercent = (userData.xp / (userData.level * XP_PER_LEVEL_BASE)) * 100;
//   return (
//     <ScrollView style={styles.screenContainer} showsVerticalScrollIndicator={false}>
//       <View style={styles.dashboardHeader}>
//         <View style={styles.profileRow}>
//           <Image source={userData.profileImage ? { uri: userData.profileImage } : { uri: 'https://via.placeholder.com/150' }} style={styles.profileImageSmall} />
//           <View><Text style={styles.playerName}>{userData.name}</Text><Text style={styles.playerRank}>LEVEL {userData.level}</Text><Text style={{color: COLORS.gold, fontSize: 10, letterSpacing: 1}}>CLASS: {userData.goal.replace('_', ' ').toUpperCase()}</Text></View>
//         </View>
//       </View>
//       <View style={styles.systemWindow}>
//         <Text style={styles.systemHeader}>STATUS</Text>
//         <View style={styles.xpBarContainer}><View style={[styles.xpBarFill, { width: `${xpPercent}%` }]} /></View>
//         <Text style={styles.xpText}>{userData.xp} / {userData.level * XP_PER_LEVEL_BASE} XP</Text>
//         <View style={styles.statGrid}>
//           <View style={styles.statItem}><Ionicons name="barbell-outline" size={20} color={COLORS.blue} /><Text style={styles.statVal}>{userData.totalWorkouts}</Text><Text style={styles.statLbl}>Raids</Text></View>
//           <View style={styles.statItem}><MaterialCommunityIcons name="fire" size={20} color={COLORS.danger} /><Text style={styles.statVal}>{userData.level}</Text><Text style={styles.statLbl}>Rank</Text></View>
//         </View>
//       </View>
//       <View style={styles.menuGrid}>
//         <TouchableOpacity style={styles.menuCardLarge} onPress={onStartQuest}>
//            <MaterialCommunityIcons name="sword-cross" size={40} color={COLORS.gold} /><Text style={styles.menuTitle}>DAILY QUEST</Text><Text style={styles.menuSub}>{userData.lastDailyQuestCompleted === getISODate(new Date()) ? 'Completed' : 'Available'}</Text>
//         </TouchableOpacity>
//         <View style={styles.menuRow}>
//            <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('programs')}><Ionicons name="list" size={24} color={COLORS.blue} /><Text style={styles.menuTitleSmall}>Programs</Text></TouchableOpacity>
//            <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('stats')}><Ionicons name="stats-chart" size={24} color={COLORS.success} /><Text style={styles.menuTitleSmall}>Stats</Text></TouchableOpacity>
//         </View>
//         <View style={styles.menuRow}>
//            <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('music')}><Ionicons name="musical-notes" size={24} color={COLORS.purple} /><Text style={styles.menuTitleSmall}>Music</Text></TouchableOpacity>
//            <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('settings')}><Ionicons name="settings" size={24} color={COLORS.textDark} /><Text style={styles.menuTitleSmall}>Settings</Text></TouchableOpacity>
//         </View>
//       </View>
//     </ScrollView>
//   );
// }

// function MusicScreen({ playlist, currentTrack, isPlaying, isLoading, position, duration, playbackMode, onPlay, onPause, onSeek, onNext, onPrev, onDelete, onAdd, onToggleMode, onBack }: any) {
//   const [searchQuery, setSearchQuery] = useState('');
//   const getModeIcon = () => {
//     switch(playbackMode) {
//       case 'loop_one': return 'repeat-once';
//       case 'loop_all': return 'repeat';
//       case 'play_one': return 'numeric-1-box-outline';
//       case 'play_all': return 'playlist-play';
//       default: return 'repeat';
//     }
//   };
//   const filteredPlaylist = playlist.filter((track: MusicTrack) => track.title.toLowerCase().includes(searchQuery.toLowerCase()));

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}>
//         <TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>MUSIC PLAYER</Text>
//         <TouchableOpacity onPress={onToggleMode} style={styles.modeBtnHeader}><MaterialCommunityIcons name={getModeIcon()} size={20} color={COLORS.blue} /></TouchableOpacity>
//       </View>
//       <View style={styles.playerMain}>
//         {currentTrack && currentTrack.artwork ? ( <Image source={{uri: currentTrack.artwork}} style={styles.albumArt} /> ) : ( <View style={styles.albumArtPlaceholder}><Ionicons name="musical-note" size={80} color={COLORS.highlight} /></View> )}
//         <Text style={styles.nowPlayingTitle} numberOfLines={1}>{currentTrack ? currentTrack.title : 'Select a Track'}</Text>
//         <View style={styles.seekContainer}>
//           <Text style={styles.timeText}>{formatTime(position)}</Text>
//           <Slider style={{flex: 1, marginHorizontal: 10}} minimumValue={0} maximumValue={duration > 0 ? duration : 1} value={position} minimumTrackTintColor={COLORS.highlight} maximumTrackTintColor={COLORS.accent} thumbTintColor={COLORS.blue} onSlidingComplete={onSeek} />
//           <Text style={styles.timeText}>{formatTime(duration)}</Text>
//         </View>
//         <View style={styles.playerControlsMain}>
//            <TouchableOpacity onPress={onPrev} style={styles.ctrlBtn}><Ionicons name="play-skip-back" size={30} color={COLORS.text} /></TouchableOpacity>
//            <TouchableOpacity onPress={onPause} style={styles.playButtonLarge}>{isLoading ? ( <View style={{width: 30, height: 30, borderWidth: 3, borderRadius: 15, borderColor: COLORS.primary, borderTopColor: COLORS.blue}} /> ) : ( <Ionicons name={isPlaying ? "pause" : "play"} size={40} color={COLORS.primary} /> )}</TouchableOpacity>
//            <TouchableOpacity onPress={onNext} style={styles.ctrlBtn}><Ionicons name="play-skip-forward" size={30} color={COLORS.text} /></TouchableOpacity>
//         </View>
//       </View>
//       <View style={styles.playlistHeader}><Text style={styles.sectionTitle}>PLAYLIST</Text><TouchableOpacity onPress={onAdd} style={styles.addBtn}><Ionicons name="add" size={20} color={COLORS.primary} /></TouchableOpacity></View>
//       <View style={{paddingHorizontal: 20, marginBottom: 5}}><View style={styles.searchContainer}><Ionicons name="search" size={20} color={COLORS.textDark} /><TextInput style={styles.searchInput} placeholder="Search tracks..." placeholderTextColor={COLORS.textDark} value={searchQuery} onChangeText={setSearchQuery} /></View></View>
//       <ScrollView style={styles.playlistContainer} showsVerticalScrollIndicator={false}>
//         {filteredPlaylist.map((track: MusicTrack) => (
//           <View key={track.id} style={[styles.trackRow, currentTrack?.id === track.id && styles.trackActive]}>
//             <TouchableOpacity style={styles.trackInfoArea} onPress={() => onPlay(track)}>
//               <View style={styles.trackIcon}><Ionicons name="musical-notes-outline" size={20} color={currentTrack?.id === track.id ? COLORS.white : COLORS.textDark} /></View>
//               <Text style={[styles.trackName, currentTrack?.id === track.id && styles.trackNameActive]} numberOfLines={1}>{track.title}</Text>
//             </TouchableOpacity>
//             <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(track.id)}><Ionicons name="trash-outline" size={18} color={COLORS.danger} /></TouchableOpacity>
//           </View>
//         ))}
//       </ScrollView>
//     </View>
//   );
// }

// function TrainingScreen({ userData, quest, onComplete, onBack, showAlert }: any) {
//   const [counts, setCounts] = useState<TrainingResult>({});
//   const [permission, requestPermission] = useCameraPermissions();
//   const [cameraType, setCameraType] = useState('front'); 
//   const [workoutTime, setWorkoutTime] = useState(0);
//   const [activeExercise, setActiveExercise] = useState<string | null>(null);
//   const [manualInputs, setManualInputs] = useState<{[key:string]: string}>({});
  
//   const cameraRef = useRef<any>(null);

//   useEffect(() => {
//     if (!permission) requestPermission();
//     const initCounts: any = {}; Object.keys(quest.exercises).forEach(k => initCounts[k] = 0); setCounts(initCounts);
//   }, [permission]);

//   // Workout Timer
//   useEffect(() => {
//     const timer = setInterval(() => {
//         setWorkoutTime(t => t + 1);
//     }, 1000);
//     return () => clearInterval(timer);
//   }, []);

//   const handleManualAdd = (ex: string, target: number) => { 
//       const amount = parseInt(manualInputs[ex] || '0');
//       if (amount > 0) {
//           const current = counts[ex] || 0; 
//           const newVal = Math.min(current + amount, target);
//           setCounts({...counts, [ex]: newVal});
//           setManualInputs({...manualInputs, [ex]: ''});
//       }
//   };

//   const handleDecrease = (ex: string) => {
//       const current = counts[ex] || 0;
//       if (current > 0) setCounts({...counts, [ex]: current - 1});
//   };

//   const handleCheckAll = () => {
//     showAlert("Complete All?", "Mark all exercises as finished?", [
//         { text: "Cancel", style: "cancel" },
//         { text: "Yes", onPress: () => setCounts(quest.exercises) }
//     ]);
//   };

//   const isCompleted = (ex: string) => (counts[ex] || 0) >= quest.exercises[ex];
//   const allCompleted = Object.keys(quest.exercises).every(isCompleted);

//   // Determine if active exercise is supported by pose detection logic
//   const isPoseSupported = (exKey: string) => PoseCalculator.isSupported(exKey);

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}>
//         <TouchableOpacity onPress={onBack}><Ionicons name="close" size={24} color={COLORS.danger} /></TouchableOpacity>
//         <Text style={styles.headerTitle}>DUNGEON INSTANCE</Text>
//         <View style={styles.timerBadge}>
//              <Ionicons name="timer-outline" size={16} color={COLORS.gold} />
//              <Text style={styles.timerValue}>{formatTime(workoutTime)}</Text>
//         </View>
//         <TouchableOpacity onPress={() => setCameraType(cameraType === 'back' ? 'front' : 'back')}><Ionicons name="camera-reverse" size={24} color={COLORS.blue} /></TouchableOpacity>
//       </View>
      
//       {userData.cameraEnabled && (
//         <View style={styles.cameraContainer}>
//           {permission?.granted ? (
//             <CameraView style={styles.camera} facing={cameraType as any} ref={cameraRef}>
//                <View style={styles.cameraOverlay}>
//                   <Text style={styles.detectionText}>SYSTEM: POSE TRACKING ACTIVE</Text>
                  
//                   {activeExercise && !isPoseSupported(activeExercise) ? (
//                       <View style={styles.camWarningBox}>
//                           <Text style={styles.camWarningText}>CANNOT DETECT WITH CAM</Text>
//                       </View>
//                   ) : (
//                       <View style={styles.poseBox} />
//                   )}
  
//                   {activeExercise && isPoseSupported(activeExercise) && (
//                       <View style={styles.poseInfoBox}>
//                           <Text style={styles.poseInfoText}>Detecting: {EXERCISES[activeExercise]?.name || activeExercise}</Text>
//                           <Text style={styles.poseInfoSub}>Ensure full body visibility</Text>
//                       </View>
//                   )}
//                </View>
//             </CameraView>
//           ) : (
//              <View style={styles.cameraOff}>
//                  <Ionicons name="videocam-off" size={40} color={COLORS.textDark} />
//                  <Text style={styles.cameraOffText}>CAMERA DISABLED</Text>
//                  <Text style={styles.cameraOffSub}>Enable in Settings for Auto-Count</Text>
//              </View>
//           )}
//         </View>
//       )}

//       <ScrollView style={styles.exerciseList} contentContainerStyle={{paddingBottom: 20}} showsVerticalScrollIndicator={false}>
//         {Object.entries(quest.exercises).map(([key, target]: [string, any]) => {
//           const def = quest.customExercises?.[key] || EXERCISES[key] || { name: key, iconName: 'help', iconLib: 'Ionicons' };
//           const count = counts[key] || 0;
//           const completed = isCompleted(key);
          
//           return (
//             <TouchableOpacity 
//                 key={key} 
//                 style={[styles.exerciseCard, completed && styles.exerciseCardDone, activeExercise === key && styles.exerciseCardActive]}
//                 onPress={() => setActiveExercise(key)}
//             >
//               <View style={styles.exHeaderRow}>
//                  <View style={styles.exIcon}><SoloIcon name={def.iconName} lib={def.iconLib} size={28} color={COLORS.blue} /></View>
//                  <View style={{flex: 1}}>
//                     <Text style={styles.exName}>{def.name}</Text>
//                     <View style={styles.progressBarBg}><View style={[styles.progressBarFill, {width: `${Math.min((count/target)*100, 100)}%`}]} /></View>
//                  </View>
//                  <Text style={styles.countTextLarge}>{count}/{target}</Text>
//               </View>

//               <View style={styles.seriesControls}>
//                  <TouchableOpacity style={styles.seriesBtnSmall} onPress={() => handleDecrease(key)} disabled={count === 0}>
//                     <Ionicons name="remove" size={16} color={COLORS.white} />
//                  </TouchableOpacity>
                 
//                  <TextInput 
//                     style={styles.seriesInput} 
//                     placeholder="#" 
//                     placeholderTextColor={COLORS.textDark}
//                     keyboardType="numeric"
//                     value={manualInputs[key] || ''}
//                     onChangeText={(t) => setManualInputs({...manualInputs, [key]: t})}
//                  />
                 
//                  <TouchableOpacity style={styles.seriesBtn} onPress={() => handleManualAdd(key, target)} disabled={completed}>
//                     <Text style={styles.seriesBtnText}>ADD SET</Text>
//                  </TouchableOpacity>
                 
//                  <TouchableOpacity style={[styles.checkBtn, completed ? styles.checkBtnDone : {}]} onPress={() => setCounts({...counts, [key]: target})}>
//                     <Ionicons name="checkmark" size={18} color={COLORS.white} />
//                  </TouchableOpacity>
//               </View>
//             </TouchableOpacity>
//           );
//         })}
//         <TouchableOpacity style={styles.checkAllBtn} onPress={handleCheckAll}>
//             <Text style={styles.checkAllText}>COMPLETE ALL EXERCISES</Text>
//         </TouchableOpacity>
        
//         {allCompleted && ( <TouchableOpacity style={styles.completeBtn} onPress={() => onComplete(counts, workoutTime)}><Text style={styles.completeBtnText}>COMPLETE DUNGEON</Text></TouchableOpacity> )}
//       </ScrollView>
//     </View>
//   );
// }

// function CustomProgramsScreen({ userData, customPrograms, setCustomPrograms, onBack, onStartProgram, showAlert }: any) {
//   const [modalVisible, setModalVisible] = useState(false);
//   const [newProgName, setNewProgName] = useState('');
//   const [editingId, setEditingId] = useState<string | null>(null);
//   const [selectedEx, setSelectedEx] = useState<{[key:string]: number}>({});
//   const [customList, setCustomList] = useState<Array<{id: string, name: string, reps: number}>>([]);
//   const [customExName, setCustomExName] = useState('');
//   const [customExCount, setCustomExCount] = useState('10');
//   const [schedule, setSchedule] = useState<string[]>([]); // New schedule state

//   const toggleExercise = (key: string) => { const next = {...selectedEx}; if (next[key]) delete next[key]; else next[key] = 10; setSelectedEx(next); };
//   const updateReps = (key: string, val: string) => { const next = {...selectedEx, [key]: parseInt(val) || 0}; setSelectedEx(next); };

//   const addCustomExercise = () => {
//     if (!customExName) { showAlert("Error", "Enter name"); return; }
//     const newEx = { id: `cust_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, name: customExName, reps: parseInt(customExCount) || 10 };
//     setCustomList([...customList, newEx]); setCustomExName(''); setCustomExCount('10');
//   };

//   const removeCustomExercise = (id: string) => { setCustomList(customList.filter(item => item.id !== id)); };

//   const toggleDay = (day: string) => {
//       if (schedule.includes(day)) setSchedule(schedule.filter(d => d !== day));
//       else setSchedule([...schedule, day]);
//   };

//   const openCreateModal = () => {
//     setNewProgName(''); setEditingId(null); setSelectedEx({}); setCustomList([]); setSchedule([]); setModalVisible(true);
//   };

//   const openEditModal = (prog: CustomProgram) => {
//     setNewProgName(prog.name); setEditingId(prog.id); setSchedule(prog.schedule || []);
//     const stdEx: {[key:string]: number} = {}; const cList: Array<{id: string, name: string, reps: number}> = [];
//     Object.entries(prog.exercises).forEach(([key, reps]) => {
//         if(EXERCISES[key]) stdEx[key] = reps;
//         else if (prog.customExercises && prog.customExercises[key]) cList.push({ id: key, name: prog.customExercises[key].name, reps: reps });
//     });
//     setSelectedEx(stdEx); setCustomList(cList); setModalVisible(true);
//   };

//   const saveProgram = () => {
//     if (!newProgName) { showAlert("Error", "Name required"); return; }
//     let customDefs: ExerciseConfig = {}; let finalExercises = { ...selectedEx };
//     customList.forEach(item => { customDefs[item.id] = { name: item.name, iconName: 'star', iconLib: 'Ionicons', custom: true, type: 'reps' }; finalExercises[item.id] = item.reps; });
//     const newProg: CustomProgram = { id: editingId ? editingId : Date.now().toString(), name: newProgName, exercises: finalExercises, customExercises: customDefs, schedule: schedule, createdAt: new Date().toISOString() };
//     let updated; if(editingId) updated = customPrograms.map((p: any) => p.id === editingId ? newProg : p); else updated = [...customPrograms, newProg];
//     setCustomPrograms(updated); setModalVisible(false);
//   };

//   const deleteProgram = (id: string) => { const updated = customPrograms.filter((p: any) => p.id !== id); setCustomPrograms(updated); };

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}>
//         <TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>CUSTOM PROGRAMS</Text>
//         <TouchableOpacity onPress={openCreateModal}><Ionicons name="add-circle" size={30} color={COLORS.blue} /></TouchableOpacity>
//       </View>
//       <ScrollView style={{padding: 20}} showsVerticalScrollIndicator={false}>
//         {customPrograms.map((p: any) => (
//            <View key={p.id} style={styles.programCard}>
//               <View style={{flex: 1}}>
//                 <Text style={styles.progTitle}>{p.name}</Text>
//                 <Text style={styles.progSub}>{Object.keys(p.exercises).length} Exercises</Text>
//                 {p.schedule && p.schedule.length > 0 && <Text style={{color: COLORS.gold, fontSize: 10}}>Scheduled: {p.schedule.join(', ')}</Text>}
//               </View>
//               <TouchableOpacity style={styles.startBtnSmall} onPress={() => onStartProgram({ title: p.name, difficulty: 1, exercises: p.exercises, rewards: { xp: 100, title: 'Custom' }, customExercises: p.customExercises, isDaily: false })}>
//                  <Text style={styles.btnTextSmall}>START</Text>
//               </TouchableOpacity>
//               <TouchableOpacity style={styles.editProgBtn} onPress={() => openEditModal(p)}><Ionicons name="create-outline" size={20} color={COLORS.white} /></TouchableOpacity>
//               <TouchableOpacity style={styles.deleteProgBtn} onPress={() => deleteProgram(p.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger} /></TouchableOpacity>
//            </View>
//         ))}
//       </ScrollView>
//       <Modal visible={modalVisible} animationType="slide" transparent>
//         <View style={styles.modalOverlay}>
//            <View style={styles.createModal}>
//               <Text style={styles.modalTitle}>{editingId ? 'EDIT PROGRAM' : 'NEW PROGRAM'}</Text>
//               <TextInput style={styles.input} placeholder="Program Name" placeholderTextColor={COLORS.textDark} value={newProgName} onChangeText={setNewProgName} />
              
//               <Text style={[styles.label, {marginTop: 10}]}>Schedule as Daily Quest:</Text>
//               <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10}}>
//                   {WEEK_DAYS.map(day => (
//                       <TouchableOpacity key={day} onPress={() => toggleDay(day)} style={[styles.dayBtn, schedule.includes(day) && styles.dayBtnActive]}>
//                           <Text style={[styles.dayBtnText, schedule.includes(day) && {color: COLORS.white}]}>{day.charAt(0)}</Text>
//                       </TouchableOpacity>
//                   ))}
//               </View>

//               <ScrollView style={{height: 200, marginVertical: 10}} showsVerticalScrollIndicator={false}>
//                  {Object.entries(EXERCISES).map(([k, v]) => (
//                     <View key={k} style={styles.selectRowContainer}>
//                         <Text style={styles.rowLabel}>{v.name}</Text>
//                         <View style={{flexDirection:'row', alignItems:'center'}}>
//                           {selectedEx[k] ? ( <TextInput style={styles.repsInput} keyboardType="numeric" value={String(selectedEx[k])} onChangeText={(val) => updateReps(k, val)} /> ) : null}
//                           <TouchableOpacity style={[styles.checkboxBtn, selectedEx[k] ? styles.checkboxActive : {}]} onPress={() => toggleExercise(k)}><Ionicons name={selectedEx[k] ? "remove" : "add"} size={20} color={selectedEx[k] ? COLORS.white : COLORS.blue} /></TouchableOpacity>
//                         </View>
//                     </View>
//                  ))}
//                  {customList.length > 0 && <Text style={[styles.label, {marginTop: 15}]}>Added Custom:</Text>}
//                  {customList.map((item) => (
//                     <View key={item.id} style={styles.selectRowContainer}>
//                         <View style={{flex:1}}><Text style={styles.rowLabel}>{item.name} ({item.reps} reps)</Text></View>
//                         <TouchableOpacity style={styles.deleteBtn} onPress={() => removeCustomExercise(item.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger} /></TouchableOpacity>
//                     </View>
//                  ))}
//               </ScrollView>
              
//               <View style={{borderTopWidth: 1, borderTopColor: COLORS.accent, paddingTop: 10}}>
//                  <Text style={styles.label}>Add Custom Exercise:</Text>
//                  <View style={styles.row}>
//                     <TextInput style={[styles.input, {flex: 2, marginRight: 5}]} placeholder="Name" placeholderTextColor={COLORS.textDark} value={customExName} onChangeText={setCustomExName} />
//                     <TextInput style={[styles.input, {flex: 1, marginRight: 5}]} keyboardType="numeric" placeholder="Reps" placeholderTextColor={COLORS.textDark} value={customExCount} onChangeText={setCustomExCount} />
//                     <TouchableOpacity style={styles.addCustomBtn} onPress={addCustomExercise}><Ionicons name="add" size={24} color={COLORS.white} /></TouchableOpacity>
//                  </View>
//               </View>

//               <View style={[styles.row, {marginTop: 10}]}>
//                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}><Text style={styles.btnText}>CANCEL</Text></TouchableOpacity>
//                  <TouchableOpacity style={styles.saveBtn} onPress={saveProgram}><Text style={styles.btnText}>SAVE</Text></TouchableOpacity>
//               </View>
//            </View>
//         </View>
//       </Modal>
//     </View>
//   );
// }

// function StatsScreen({ userData, onBack }: any) {
//   const [data, setData] = useState<number[]>([0]);
//   useEffect(() => { 
//     AsyncStorage.getItem('trainingHistory').then(h => { 
//         if(h) { 
//             const history = JSON.parse(h); 
//             // Group by date (YYYY-MM-DD) and sum XP
//             const grouped: {[key: string]: number} = {};
//             history.forEach((entry: TrainingHistory) => {
//                 const dateKey = entry.date.split('T')[0];
//                 grouped[dateKey] = (grouped[dateKey] || 0) + entry.xpGained;
//             });
//             // Sort by date key to ensure order
//             const sortedKeys = Object.keys(grouped).sort();
//             const xpData = sortedKeys.map(k => grouped[k]);
            
//             // Slice last 6 or default to [0]
//             if(xpData.length > 0) setData(xpData.slice(-6));
//             else setData([0]);
//         } 
//     }); 
//   }, []);
  
//   return (
//     <ScrollView style={styles.screenContainer} showsVerticalScrollIndicator={false}>
//        <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>STATISTICS</Text><View style={{width: 24}} /></View>
//       <View style={{padding: 20}}>
//         <Text style={styles.sectionTitle}>XP GAIN HISTORY</Text>
//         <LineChart
//           data={{ labels: ["1", "2", "3", "4", "5", "6"], datasets: [{ data: data }] }}
//           width={width - 40} height={220} yAxisLabel="" yAxisSuffix=" XP"
//           chartConfig={{
//             backgroundColor: COLORS.secondary, backgroundGradientFrom: COLORS.secondary, backgroundGradientTo: COLORS.accent,
//             decimalPlaces: 0, color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`, labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
//             style: { borderRadius: 16 }, propsForDots: { r: "6", strokeWidth: "2", stroke: COLORS.glow }
//           }}
//           style={{ marginVertical: 8, borderRadius: 16 }}
//         />
//         <View style={styles.statBoxLarge}><Text style={styles.bigStat}>{userData.totalWorkouts}</Text><Text style={styles.bigStatLbl}>TOTAL DUNGEONS CLEARED</Text></View>
//       </View>
//     </ScrollView>
//   );
// }

// function QuestScreen({ userData, customPrograms, onBack, onStartTraining }: any) {
//    // Generate Quest based on Goal and Level AND Schedule
//    const getDailyQuest = (): Quest => {
//       const todayDay = getDayString(new Date());
      
//       // 1. Check for Scheduled Custom Program
//       const scheduledProg = customPrograms.find((p: CustomProgram) => p.schedule && p.schedule.includes(todayDay));
//       if (scheduledProg) {
//           // Calculate XP based on level scaling roughly (standard reward for daily)
//           return {
//               title: `DAILY: ${scheduledProg.name.toUpperCase()}`,
//               difficulty: Math.floor(userData.level / 5) + 1,
//               exercises: scheduledProg.exercises,
//               customExercises: scheduledProg.customExercises,
//               rewards: { xp: userData.level * 150, title: 'Hunter' }, // High reward for scheduled custom
//               isDaily: true
//           };
//       }

//       // 2. Fallback to Standard Logic
//       const level = userData.level;
//       let exercises: {[key:string]: number} = {};
//       let title = "DAILY QUEST";
//       let rewardXP = level * 100; // Base reward

//       if (userData.goal === 'speed_strength') {
//           title = "ASSASSIN TRAINING";
//           exercises = { clapPushups: Math.ceil(level * 5), jumpSquats: Math.ceil(level * 10), situps: Math.ceil(level * 10), running: Math.min(1 + (level * 0.2), 5) };
//       } else if (userData.goal === 'weight_loss') {
//           title = "ENDURANCE TRIAL";
//           exercises = { squats: level * 15, situps: level * 15, burpees: level * 5, running: Math.min(2 + (level * 0.5), 10) };
//       } else {
//           title = "STRENGTH TRAINING";
//           exercises = { pushups: level * 10, squats: level * 10, situps: level * 10, pullups: Math.ceil(level * 2) };
//       }

//       return { title, difficulty: Math.floor(level / 5) + 1, exercises, rewards: { xp: rewardXP, title: 'Hunter' }, isDaily: true };
//    };

//    const dailyQuest = getDailyQuest();

//    return (
//       <View style={styles.screenContainer}>
//          <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>QUEST INFO</Text><View style={{width: 24}} /></View>
//          <View style={styles.questPaperDark}>
//             <Text style={styles.questTitleDark}>{dailyQuest.title}</Text>
//             <Text style={styles.difficulty}>Rank: {'★'.repeat(dailyQuest.difficulty)}</Text>
//             <View style={styles.divider} />
//             <Text style={styles.objTitleDark}>OBJECTIVES:</Text>
//             {Object.entries(dailyQuest.exercises).map(([k, v]) => (
//                <View key={k} style={styles.objRow}>
//                   <View style={{flexDirection: 'row', alignItems: 'center'}}>
//                      <View style={{width: 6, height: 6, backgroundColor: COLORS.blue, marginRight: 8}} />
//                      <Text style={styles.objTextDark}>{(dailyQuest.customExercises?.[k]?.name) || EXERCISES[k]?.name || k}</Text>
//                   </View>
//                   <Text style={styles.objValDark}>{v} {EXERCISES[k]?.type === 'distance' ? 'km' : ''}</Text>
//                </View>
//             ))}
//             <View style={styles.divider} />
//             <Text style={styles.rewardTitleDark}>REWARDS:</Text>
//             <Text style={styles.rewardText}>+ {dailyQuest.rewards.xp} XP</Text>
//          </View>
//          <TouchableOpacity style={[styles.acceptBtn, userData.lastDailyQuestCompleted === getISODate(new Date()) ? {backgroundColor: COLORS.textDark} : {}]} disabled={userData.lastDailyQuestCompleted === getISODate(new Date())} onPress={() => onStartTraining(dailyQuest)}>
//             <Text style={styles.acceptBtnText}>{userData.lastDailyQuestCompleted === getISODate(new Date()) ? 'QUEST COMPLETE' : 'ACCEPT QUEST'}</Text>
//          </TouchableOpacity>
//       </View>
//    );
// }

// function SettingsScreen({ userData, onSave, onBack }: any) {
//   const [camEnabled, setCamEnabled] = useState(userData.cameraEnabled);
//   const [name, setName] = useState(userData.name);
//   const [image, setImage] = useState(userData.profileImage);
//   const pickImage = async () => { let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5 }); if (!result.canceled) setImage(result.assets[0].uri); };
//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>SYSTEM SETTINGS</Text><View style={{width:24}} /></View>
//       <ScrollView style={{padding: 20}} showsVerticalScrollIndicator={false}>
//          <View style={{alignItems: 'center', marginBottom: 20}}>
//             <TouchableOpacity onPress={pickImage}><Image source={image ? { uri: image } : { uri: 'https://via.placeholder.com/150' }} style={styles.settingsAvatar} /><View style={styles.editIconBadge}><Ionicons name="camera" size={14} color={COLORS.white} /></View></TouchableOpacity>
//             <Text style={[styles.label, {marginTop: 10}]}>EDIT HUNTER NAME</Text><TextInput style={[styles.input, {textAlign: 'center', width: '80%'}]} value={name} onChangeText={setName} placeholder="Hunter Name" placeholderTextColor={COLORS.textDark} />
//          </View>
//          <View style={styles.divider} />
//          <View style={styles.settingRow}><Text style={styles.settingText}>Enable Pose Detection (Camera)</Text><TouchableOpacity onPress={() => setCamEnabled(!camEnabled)}><Ionicons name={camEnabled ? "checkbox" : "square-outline"} size={28} color={COLORS.blue} /></TouchableOpacity></View>
//          <TouchableOpacity style={styles.settingsSaveBtn} onPress={() => onSave({...userData, cameraEnabled: camEnabled, name: name, profileImage: image})}><Text style={styles.settingsSaveBtnText}>SAVE CHANGES</Text></TouchableOpacity>
//       </ScrollView>
//     </View>
//   );
// }

// // --- Helpers ---
// const formatTime = (seconds: number) => {
//   const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60);
//   return `${m}:${s < 10 ? '0' : ''}${s}`;
// };

// // --- Styles ---
// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: COLORS.primary },
//   screenContainer: { flex: 1, backgroundColor: COLORS.primary },
//   centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.primary },
//   loadingTitle: { fontSize: 32, fontWeight: '900', color: COLORS.blue, letterSpacing: 4 },
//   loadingSubtitle: { color: COLORS.textDark, marginTop: 10, letterSpacing: 2 },
//   header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: COLORS.accent },
//   headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', letterSpacing: 1.5 },
//   timerBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: COLORS.gold },
//   timerValue: { color: COLORS.gold, fontWeight: 'bold', marginLeft: 5, fontSize: 12 },
//   avatarPicker: { alignSelf: 'center', marginVertical: 20 },
//   avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: COLORS.accent, justifyContent: 'center', alignItems: 'center', borderStyle: 'dashed', borderWidth: 1, borderColor: COLORS.textDark },
//   avatarImage: { width: 100, height: 100, borderRadius: 50 },
//   avatarText: { fontSize: 10, color: COLORS.textDark, marginTop: 5 },
//   formGroup: { marginBottom: 15 },
//   row: { flexDirection: 'row', justifyContent: 'space-between' },
//   label: { color: COLORS.blue, fontSize: 12, marginBottom: 5, fontWeight: 'bold' },
//   input: { backgroundColor: COLORS.secondary, color: COLORS.text, padding: 15, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent },
//   genderContainer: { flexDirection: 'row', justifyContent: 'space-between' },
//   genderBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15, backgroundColor: COLORS.secondary, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent, marginHorizontal: 5 },
//   genderBtnActive: { backgroundColor: COLORS.blue, borderColor: COLORS.glow },
//   genderText: { color: COLORS.blue, fontWeight: 'bold', marginLeft: 8 },
//   genderTextActive: { color: COLORS.white, fontWeight: 'bold', marginLeft: 8 },
//   goalBtn: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: COLORS.secondary, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent, marginBottom: 8 },
//   goalBtnActive: { backgroundColor: COLORS.blue, borderColor: COLORS.glow },
//   goalText: { color: COLORS.blue, fontWeight: 'bold', marginLeft: 15 },
//   goalTextActive: { color: COLORS.white, fontWeight: 'bold', marginLeft: 15 },
//   mainButton: { backgroundColor: COLORS.blue, padding: 18, borderRadius: 8, alignItems: 'center', marginTop: 20 },
//   mainButtonText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 16, letterSpacing: 2 },
//   dashboardHeader: { padding: 20, paddingTop: 10 },
//   profileRow: { flexDirection: 'row', alignItems: 'center' },
//   profileImageSmall: { width: 60, height: 60, borderRadius: 30, marginRight: 15, borderWidth: 2, borderColor: COLORS.blue },
//   playerName: { color: COLORS.text, fontSize: 22, fontWeight: 'bold' },
//   playerRank: { color: COLORS.glow, fontSize: 12, letterSpacing: 1 },
//   systemWindow: { margin: 20, padding: 20, backgroundColor: COLORS.secondary, borderRadius: 12, borderWidth: 1, borderColor: COLORS.blue },
//   systemHeader: { color: COLORS.text, textAlign: 'center', fontWeight: 'bold', marginBottom: 15 },
//   xpBarContainer: { height: 6, backgroundColor: COLORS.accent, borderRadius: 3, marginBottom: 5 },
//   xpBarFill: { height: '100%', backgroundColor: COLORS.blue, borderRadius: 3 },
//   xpText: { color: COLORS.textDark, fontSize: 10, textAlign: 'right', marginBottom: 15 },
//   statGrid: { flexDirection: 'row', justifyContent: 'space-around' },
//   statItem: { alignItems: 'center' },
//   statVal: { color: COLORS.text, fontSize: 18, fontWeight: 'bold' },
//   statLbl: { color: COLORS.textDark, fontSize: 10 },
//   menuGrid: { padding: 20 },
//   menuCardLarge: { backgroundColor: COLORS.accent, padding: 20, borderRadius: 12, alignItems: 'center', marginBottom: 15, borderWidth: 1, borderColor: COLORS.gold },
//   menuTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', marginTop: 10 },
//   menuSub: { color: COLORS.danger, fontSize: 12 },
//   menuRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
//   menuCardSmall: { backgroundColor: COLORS.secondary, width: '48%', padding: 15, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.accent },
//   menuTitleSmall: { color: COLORS.text, marginTop: 5, fontSize: 12 },
//   playerMain: { alignItems: 'center', padding: 20 },
//   albumArtPlaceholder: { width: 140, height: 140, backgroundColor: COLORS.secondary, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 15, borderWidth: 1, borderColor: COLORS.accent },
//   albumArt: { width: 140, height: 140, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: COLORS.accent },
//   nowPlayingTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', marginBottom: 10, textAlign: 'center' },
//   seekContainer: { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 15 },
//   timeText: { color: COLORS.textDark, fontSize: 10, width: 35, textAlign: 'center' },
//   playerControlsMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', width: '80%' },
//   playButtonLarge: { width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.blue, justifyContent: 'center', alignItems: 'center' },
//   ctrlBtn: { padding: 10 },
//   modeBtnHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, padding: 5, borderRadius: 5, borderWidth: 1, borderColor: COLORS.accent },
//   playlistHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginTop: 10 },
//   sectionTitle: { color: COLORS.blue, fontWeight: 'bold' },
//   addBtn: { backgroundColor: COLORS.highlight, padding: 5, borderRadius: 4 },
//   searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: COLORS.accent, marginTop: 10 },
//   searchInput: { flex: 1, color: COLORS.text, marginLeft: 10, paddingVertical: 5 },
//   playlistContainer: { padding: 20 },
//   trackRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.accent, justifyContent: 'space-between' },
//   trackActive: { backgroundColor: COLORS.accent },
//   trackInfoArea: { flexDirection: 'row', alignItems: 'center', flex: 1 },
//   trackIcon: { width: 30 },
//   trackName: { color: COLORS.textDark, flex: 1, fontSize: 14, marginLeft: 5 },
//   trackNameActive: { color: COLORS.white, fontWeight: 'bold', textShadowColor: COLORS.glow, textShadowRadius: 8 },
//   deleteBtn: { padding: 5 },
//   miniPlayerContainer: { position: 'relative', bottom: 0, left: 0, right: 0, height: 70, backgroundColor: COLORS.secondary, borderTopWidth: 1, borderTopColor: COLORS.blue, zIndex: 999 },
//   miniProgressContainer: { height: 2, backgroundColor: COLORS.accent, width: '100%' },
//   miniProgressFill: { height: '100%', backgroundColor: COLORS.highlight },
//   miniPlayerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, flex: 1 },
//   miniInfo: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 10 },
//   miniArt: { width: 40, height: 40, borderRadius: 4, marginRight: 10 },
//   miniTitle: { color: COLORS.white, fontWeight: 'bold', fontSize: 14 },
//   miniTime: { color: COLORS.textDark, fontSize: 10 },
//   miniControls: { flexDirection: 'row', alignItems: 'center' },
//   miniCtrlBtn: { marginHorizontal: 8 },
//   cameraContainer: { height: 250, backgroundColor: '#000', overflow: 'hidden' },
//   camera: { flex: 1 },
//   cameraOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
//   detectionText: { color: COLORS.success, fontSize: 10, position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', padding: 4 },
//   poseBox: { width: 200, height: 300, borderWidth: 2, borderColor: COLORS.glow, opacity: 0.5 },
//   camWarningBox: { backgroundColor: 'rgba(239, 68, 68, 0.8)', padding: 10, borderRadius: 5 },
//   camWarningText: { color: COLORS.white, fontWeight: 'bold' },
//   poseInfoBox: { position: 'absolute', bottom: 10, left: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 5 },
//   poseInfoText: { color: COLORS.success, fontWeight: 'bold', fontSize: 12 },
//   poseInfoSub: { color: COLORS.textDark, fontSize: 10 },
//   cameraOff: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.secondary },
//   cameraOffText: { color: COLORS.text, fontWeight: 'bold', marginTop: 10 },
//   cameraOffSub: { color: COLORS.textDark, fontSize: 10 },
//   exerciseList: { flex: 1, padding: 20 },
//   exerciseCard: { backgroundColor: COLORS.secondary, padding: 15, marginBottom: 10, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent },
//   exerciseCardActive: { borderColor: COLORS.blue, backgroundColor: '#1e293b' },
//   exerciseCardDone: { opacity: 0.6, borderColor: COLORS.success },
//   exHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
//   exIcon: { width: 40 },
//   exName: { color: COLORS.text, fontWeight: 'bold', marginBottom: 5 },
//   progressBarBg: { height: 4, backgroundColor: COLORS.accent, borderRadius: 2, width: '90%' },
//   progressBarFill: { height: '100%', backgroundColor: COLORS.blue, borderRadius: 2 },
//   countTextLarge: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' },
//   seriesControls: { flexDirection: 'row', alignItems: 'center', marginTop: 5, justifyContent: 'flex-end' },
//   seriesInput: { width: 50, height: 35, backgroundColor: COLORS.primary, color: COLORS.white, textAlign: 'center', borderRadius: 4, borderWidth: 1, borderColor: COLORS.accent, marginHorizontal: 5 },
//   seriesBtn: { backgroundColor: COLORS.blue, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 4, marginHorizontal: 5 },
//   seriesBtnSmall: { backgroundColor: COLORS.accent, width: 35, height: 35, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
//   seriesBtnText: { color: COLORS.white, fontSize: 10, fontWeight: 'bold' },
//   checkBtn: { width: 35, height: 35, borderRadius: 17.5, borderWidth: 1, borderColor: COLORS.textDark, alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
//   checkBtnDone: { backgroundColor: COLORS.success, borderColor: COLORS.success },
//   checkAllBtn: { marginVertical: 10, padding: 10, borderWidth: 1, borderColor: COLORS.blue, borderRadius: 8, alignItems: 'center' },
//   checkAllText: { color: COLORS.blue, fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
//   completeBtn: { backgroundColor: COLORS.blue, margin: 20, padding: 15, borderRadius: 8, alignItems: 'center' },
//   completeBtnText: { color: COLORS.primary, fontWeight: 'bold', letterSpacing: 2 },
//   programCard: { backgroundColor: COLORS.secondary, padding: 15, borderRadius: 8, marginBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
//   progTitle: { color: COLORS.text, fontSize: 16, fontWeight: 'bold' },
//   progSub: { color: COLORS.textDark, fontSize: 12 },
//   startBtnSmall: { backgroundColor: COLORS.success, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4, marginRight: 10 },
//   editProgBtn: { backgroundColor: COLORS.accent, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4, marginRight: 10 },
//   deleteProgBtn: { padding: 5 },
//   btnTextSmall: { color: COLORS.primary, fontWeight: 'bold', fontSize: 10 },
//   modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
//   createModal: { backgroundColor: COLORS.secondary, padding: 20, borderRadius: 12, borderWidth: 1, borderColor: COLORS.blue },
//   modalTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 15 },
//   selectRowContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: COLORS.accent },
//   rowLabel: { color: COLORS.textDark, fontSize: 16 },
//   repsInput: { backgroundColor: COLORS.primary, color: COLORS.white, width: 50, padding: 5, borderRadius: 4, textAlign: 'center', borderWidth: 1, borderColor: COLORS.blue, marginRight: 10 },
//   checkboxBtn: { padding: 5, borderRadius: 4, borderWidth: 1, borderColor: COLORS.blue },
//   checkboxActive: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
//   addCustomBtn: { backgroundColor: COLORS.blue, padding: 10, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
//   cancelBtn: { flex: 1, padding: 15, alignItems: 'center', marginRight: 10 },
//   saveBtn: { flex: 1, backgroundColor: COLORS.blue, padding: 15, alignItems: 'center', borderRadius: 6 },
//   btnText: { color: COLORS.text, fontWeight: 'bold' },
//   settingsSaveBtn: { backgroundColor: COLORS.blue, padding: 18, borderRadius: 8, alignItems: 'center', marginTop: 30 },
//   settingsSaveBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },
//   settingsAvatar: { width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: COLORS.blue, marginBottom: 10 },
//   editIconBadge: { position: 'absolute', bottom: 10, right: 10, backgroundColor: COLORS.blue, width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: COLORS.secondary },
//   statBoxLarge: { backgroundColor: COLORS.accent, padding: 20, alignItems: 'center', borderRadius: 12, marginTop: 20 },
//   bigStat: { color: COLORS.blue, fontSize: 40, fontWeight: 'bold' },
//   bigStatLbl: { color: COLORS.textDark, fontSize: 12, letterSpacing: 2 },
//   questPaperDark: { backgroundColor: COLORS.secondary, margin: 20, padding: 20, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent },
//   questTitleDark: { color: COLORS.text, fontSize: 20, fontWeight: 'bold', textAlign: 'center' },
//   difficulty: { color: COLORS.gold, textAlign: 'center', fontSize: 12, marginBottom: 10 },
//   objTitleDark: { color: COLORS.blue, fontWeight: 'bold', marginTop: 10 },
//   objRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
//   objTextDark: { color: COLORS.text },
//   objValDark: { color: COLORS.text, fontWeight: 'bold' },
//   divider: { height: 1, backgroundColor: COLORS.accent, marginVertical: 10 },
//   rewardTitleDark: { color: COLORS.text, fontWeight: 'bold' },
//   rewardText: { color: COLORS.blue, fontWeight: 'bold' },
//   acceptBtn: { backgroundColor: COLORS.blue, margin: 20, padding: 15, borderRadius: 8, alignItems: 'center' },
//   acceptBtnText: { color: COLORS.primary, fontWeight: 'bold', letterSpacing: 2 },
//   settingRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: COLORS.accent, alignItems: 'center' },
//   settingText: { color: COLORS.text, fontSize: 16 },
//   alertBox: { backgroundColor: COLORS.secondary, borderRadius: 12, borderWidth: 2, borderColor: COLORS.blue, padding: 20, width: '100%' },
//   alertTitle: { color: COLORS.blue, fontSize: 18, fontWeight: 'bold', textAlign: 'center', letterSpacing: 1 },
//   alertMessage: { color: COLORS.text, textAlign: 'center', marginVertical: 15 },
//   alertButtons: { flexDirection: 'row', justifyContent: 'center', marginTop: 10 },
//   alertButton: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 6, minWidth: 80, alignItems: 'center', marginHorizontal: 5 },
//   alertButtonDefault: { backgroundColor: COLORS.blue },
//   alertButtonDestructive: { backgroundColor: COLORS.danger },
//   alertButtonCancel: { backgroundColor: COLORS.accent },
//   alertButtonText: { color: COLORS.text, fontWeight: 'bold', fontSize: 12 },
//   timerCircle: { width: 120, height: 120, borderRadius: 60, borderWidth: 4, borderColor: COLORS.blue, justifyContent: 'center', alignItems: 'center', marginVertical: 30 },
//   timerText: { fontSize: 40, fontWeight: 'bold', color: COLORS.white },
//   dayBtn: { width: 35, height: 35, borderRadius: 17.5, backgroundColor: COLORS.secondary, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.accent },
//   dayBtnActive: { backgroundColor: COLORS.blue, borderColor: COLORS.glow },
//   dayBtnText: { color: COLORS.textDark, fontSize: 12, fontWeight: 'bold' },
// });






// import React, { useState, useEffect, useRef } from 'react';
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   ScrollView,
//   TextInput,
//   Animated,
//   Dimensions,
//   StatusBar,
//   Modal,
//   Image,
//   Vibration,
//   Platform,
// } from 'react-native';
// import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
// import AsyncStorage from '@react-native-async-storage/async-storage';
// import { CameraView, useCameraPermissions } from 'expo-camera'; // Kept File 1's CameraView
// import { LineChart } from 'react-native-chart-kit';
// import { Audio } from 'expo-av'; // Switched to expo-av for background support
// import * as DocumentPicker from 'expo-document-picker';
// import * as ImagePicker from 'expo-image-picker';
// import Slider from '@react-native-community/slider';
// import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';

// const { width, height } = Dimensions.get('window');

// // --- Type Definitions ---
// type GoalType = 'muscle' | 'weight_loss' | 'speed_strength';

// interface UserData {
//   name: string;
//   level: number;
//   sex: 'male' | 'female';
//   weight: number;
//   height: number;
//   goal: GoalType; 
//   xp: number;
//   totalWorkouts: number;
//   createdAt: string;
//   lastDailyQuestCompleted?: string; // ISO Date only YYYY-MM-DD
//   cameraEnabled: boolean;
//   profileImage?: string;
//   assessmentStats?: { [key: string]: number };
// }

// interface Exercise {
//   name: string;
//   iconName: string;
//   iconLib: 'Ionicons' | 'MaterialCommunityIcons' | 'FontAwesome5';
//   type?: 'reps' | 'duration' | 'distance';
//   custom?: boolean;
// }

// interface ExerciseConfig {
//   [key: string]: Exercise;
// }

// interface Quest {
//   title: string;
//   difficulty: number;
//   exercises: { [key: string]: number };
//   rewards: {
//     xp: number;
//     title: string;
//   };
//   customExercises?: ExerciseConfig;
//   isDaily?: boolean; // To track if this is the daily requirement
// }

// interface TrainingResult {
//   [key: string]: number;
// }

// interface TrainingHistory {
//   date: string;
//   quest: Quest;
//   results: TrainingResult;
//   xpGained: number;
//   durationSeconds?: number;
// }

// interface MusicTrack {
//   id: string;
//   title: string;
//   path: any; // require() or uri string
//   isLocal: boolean;
//   isFavorite: boolean;
//   artwork?: string;
// }

// interface CustomProgram {
//   id: string;
//   name: string;
//   exercises: { [key: string]: number };
//   customExercises?: ExerciseConfig;
//   schedule: string[]; // ['Mon', 'Wed', etc.]
//   createdAt: string;
// }

// interface AlertButton {
//   text: string;
//   onPress?: () => void;
//   style?: 'default' | 'cancel' | 'destructive';
// }

// interface CustomAlertState {
//   visible: boolean;
//   title: string;
//   message: string;
//   buttons: AlertButton[];
// }

// type PlaybackMode = 'loop_all' | 'play_all' | 'loop_one' | 'play_one';

// // --- Theme ---
// const COLORS = {
//   primary: '#050714',     
//   secondary: '#0F172A',   
//   accent: '#1E293B',      
//   highlight: '#2563EB',   
//   blue: '#3B82F6',        
//   lightBlue: '#60A5FA',
//   purple: '#7C3AED',      
//   danger: '#EF4444',
//   success: '#10B981',
//   text: '#F8FAFC',
//   textDark: '#94A3B8',
//   glow: '#0EA5E9',
//   gold: '#F59E0B',
//   white: '#FFFFFF',
// };

// // --- Constants ---
// const XP_PER_LEVEL_BASE = 600; 
// const PENALTY_XP = 100;
// const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// const EXERCISES: ExerciseConfig = {
//   // Standard
//   squats: { name: 'Squats', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   pushups: { name: 'Push-ups', iconName: 'human-handsup', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   situps: { name: 'Sit-ups', iconName: 'dumbbell', iconLib: 'FontAwesome5', type: 'reps' },
//   pullups: { name: 'Pull-ups', iconName: 'human-male-height', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   bicepCurls: { name: 'Bicep Curls', iconName: 'arm-flex', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   lunges: { name: 'Lunges', iconName: 'run', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   plank: { name: 'Plank (sec)', iconName: 'timer', iconLib: 'Ionicons', type: 'duration' },
//   running: { name: 'Running (km)', iconName: 'run-fast', iconLib: 'MaterialCommunityIcons', type: 'distance' },
  
//   // Dynamic / Speed & Strength
//   clapPushups: { name: 'Clap Push-ups', iconName: 'flash', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   jumpSquats: { name: 'Jump Squats', iconName: 'arrow-up-bold-circle', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   burpees: { name: 'Burpees', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
// };

// // --- Pose Detection Logic ---
// class PoseCalculator {
//   static calculateAngle(a: {x:number, y:number}, b: {x:number, y:number}, c: {x:number, y:number}) {
//     const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
//     let angle = Math.abs(radians * 180.0 / Math.PI);
//     if (angle > 180.0) angle = 360 - angle;
//     return angle;
//   }

//   static detectSquat(landmarks: any): { angle: number } {
//     return { angle: 0 }; 
//   }

//   static isSupported(exerciseKey: string): boolean {
//       const supported = ['squats', 'pushups', 'situps', 'bicepCurls', 'lifting'];
//       return supported.includes(exerciseKey);
//   }
// }

// // --- Sound System ---
// const SYSTEM_SOUND = require('../assets/audio/solo_leveling_system.mp3'); 
// const DEFAULT_OST = require('../assets/audio/ost.mp3');

// // --- Helper Functions ---
// const getDayString = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'short' });
// const getISODate = (date: Date) => date.toISOString().split('T')[0];

// // --- Helper Components ---
// const SoloIcon = ({ name, lib, size = 24, color = COLORS.text }: { name: string, lib: string, size?: number, color?: string }) => {
//   if (lib === 'Ionicons') return <Ionicons name={name as any} size={size} color={color} />;
//   if (lib === 'MaterialCommunityIcons') return <MaterialCommunityIcons name={name as any} size={size} color={color} />;
//   if (lib === 'FontAwesome5') return <FontAwesome5 name={name as any} size={size} color={color} />;
//   return null;
// };

// const CustomAlert = ({ visible, title, message, buttons, onClose }: { visible: boolean, title: string, message: string, buttons: AlertButton[], onClose: () => void }) => {
//   if (!visible) return null;
//   return (
//     <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
//       <View style={styles.modalOverlay}>
//         <View style={styles.alertBox}>
//           <Text style={styles.alertTitle}>{title}</Text>
//           <View style={styles.divider} />
//           <Text style={styles.alertMessage}>{message}</Text>
//           <View style={styles.alertButtons}>
//             {buttons.map((btn, index) => (
//               <TouchableOpacity
//                 key={index}
//                 style={[
//                   styles.alertButton,
//                   btn.style === 'destructive' ? styles.alertButtonDestructive : 
//                   btn.style === 'cancel' ? styles.alertButtonCancel : styles.alertButtonDefault
//                 ]}
//                 onPress={() => {
//                   if (btn.onPress) btn.onPress();
//                   onClose();
//                 }}
//               >
//                 <Text style={styles.alertButtonText}>{btn.text}</Text>
//               </TouchableOpacity>
//             ))}
//           </View>
//         </View>
//       </View>
//     </Modal>
//   );
// };

// // --- Main App ---
// export default function SoloLevelingFitnessTracker(): JSX.Element {
//   // Global State
//   const [screen, setScreenState] = useState<string>('loading');
//   const [userData, setUserData] = useState<UserData | null>(null);
//   const [customPrograms, setCustomPrograms] = useState<CustomProgram[]>([]);
  
//   // Alert State
//   const [alertState, setAlertState] = useState<CustomAlertState>({
//     visible: false, title: '', message: '', buttons: [],
//   });

//   // Music Player State (Updated to expo-av for background playback)
//   const [playlist, setPlaylist] = useState<MusicTrack[]>([]);
//   const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
//   const [sound, setSound] = useState<Audio.Sound | null>(null); // Changed to Sound object
//   const [isPlaying, setIsPlaying] = useState(false);
//   const [musicLoading, setMusicLoading] = useState(false); 
//   const [position, setPosition] = useState(0);
//   const [duration, setDuration] = useState(0);
//   const [isMuted, setIsMuted] = useState(false);
//   const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('loop_all');
  
//   // Refs for logic to avoid stale closures
//   const playlistRef = useRef<MusicTrack[]>([]);
//   const currentTrackRef = useRef<MusicTrack | null>(null);
//   const playbackModeRef = useRef<PlaybackMode>('loop_all');

//   useEffect(() => { playlistRef.current = playlist; }, [playlist]);
//   useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
//   useEffect(() => { playbackModeRef.current = playbackMode; }, [playbackMode]);

//   // System Sound State
//   const [systemSoundObj, setSystemSoundObj] = useState<Audio.Sound | null>(null);

//   // Training State
//   const [currentQuest, setCurrentQuest] = useState<Quest | null>(null);
//   const [isTraining, setIsTraining] = useState<boolean>(false);

//   // --- Audio System Logic ---

//   const playSystemSound = async () => {
//     try {
//       if (systemSoundObj) {
//         await systemSoundObj.unloadAsync();
//       }
//       // Ducking music volume manually if needed, though expo-av ducking handles some of this
//       if (sound && isPlaying) {
//         await sound.setVolumeAsync(0.1); 
//       }

//       const { sound: newSysSound } = await Audio.Sound.createAsync(SYSTEM_SOUND);
//       setSystemSoundObj(newSysSound);
//       await newSysSound.playAsync();

//       newSysSound.setOnPlaybackStatusUpdate(async (status) => {
//         if (status.isLoaded && status.didJustFinish) {
//             await newSysSound.unloadAsync();
//             setSystemSoundObj(null);
//             // Restore music volume
//             if (sound && isPlaying) await sound.setVolumeAsync(1.0);
//         }
//       });
//     } catch (error) { console.log('System sound error', error); }
//   };

//   const navigateTo = (newScreen: string) => {
//     if (newScreen !== screen) {
//       playSystemSound();
//       setScreenState(newScreen);
//     }
//   };

//   const showAlert = (title: string, message: string, buttons: AlertButton[] = [{ text: 'OK' }]) => {
//     setAlertState({ visible: true, title, message, buttons });
//   };

//   const closeAlert = () => {
//     setAlertState(prev => ({ ...prev, visible: false }));
//   };

//   // --- Initialization & Penalty System ---
//   useEffect(() => {
//     async function init() {
//       // 1. Configure Background Audio (Crucial for background playback)
//       try {
//         await Audio.setAudioModeAsync({
//           allowsRecordingIOS: false,
//           staysActiveInBackground: true, // Key for background audio
//           playsInSilentModeIOS: true,
//           shouldDuckAndroid: true,
//           playThroughEarpieceAndroid: false,
//         });
//       } catch (e) {
//         console.warn("Audio Mode Config Error:", e);
//       }

//       // Load Music
//       try {
//         const stored = await AsyncStorage.getItem('musicPlaylist');
//         const defaultTrack: MusicTrack = { id: 'default_ost', title: 'System Soundtrack (Default)', path: DEFAULT_OST, isLocal: true, isFavorite: true };
//         let tracks: MusicTrack[] = [defaultTrack];
//         if (stored) {
//           const parsed = JSON.parse(stored);
//           const userTracks = parsed.filter((t: MusicTrack) => t.id !== 'default_ost');
//           tracks = [...tracks, ...userTracks];
//         }
//         setPlaylist(tracks);
//       } catch (e) { console.error("Audio Init Error", e); }

//       playSystemSound();
      
//       // Load Data
//       const progData = await AsyncStorage.getItem('customPrograms');
//       const loadedPrograms: CustomProgram[] = progData ? JSON.parse(progData) : [];
//       setCustomPrograms(loadedPrograms);

//       const data = await AsyncStorage.getItem('userData');
//       if (data) {
//         let user: UserData = JSON.parse(data);
//         user = await checkPenalties(user, loadedPrograms); // Check for missed quests
//         setUserData(user);
//         setScreenState('dashboard');
//       } else {
//         setScreenState('setup');
//       }
//     }
//     init();

//     return () => {
//       if (sound) sound.unloadAsync();
//       if (systemSoundObj) systemSoundObj.unloadAsync();
//     };
//   }, []);

//   const checkPenalties = async (user: UserData, programs: CustomProgram[]): Promise<UserData> => {
//     if (!user.lastDailyQuestCompleted) {
//         const yesterday = new Date();
//         yesterday.setDate(yesterday.getDate() - 1);
//         user.lastDailyQuestCompleted = getISODate(yesterday);
//         await AsyncStorage.setItem('userData', JSON.stringify(user));
//         return user;
//     }

//     const lastDate = new Date(user.lastDailyQuestCompleted);
//     const today = new Date();
//     const todayStr = getISODate(today);
    
//     if (user.lastDailyQuestCompleted === todayStr) return user;

//     let penaltyXP = 0;
//     let missedDays = 0;
    
//     const checkDate = new Date(lastDate);
//     checkDate.setDate(checkDate.getDate() + 1);

//     while (getISODate(checkDate) < todayStr) {
//         penaltyXP += PENALTY_XP;
//         missedDays++;
//         checkDate.setDate(checkDate.getDate() + 1);
//     }

//     if (penaltyXP > 0) {
//         let newXP = user.xp - penaltyXP;
//         let newLevel = user.level;

//         while (newXP < 0) {
//             if (newLevel > 1) {
//                 newLevel--;
//                 const xpForPrevLevel = newLevel * XP_PER_LEVEL_BASE;
//                 newXP = xpForPrevLevel + newXP;
//             } else {
//                 newXP = 0;
//                 break;
//             }
//         }

//         user.xp = newXP;
//         user.level = newLevel;

//         showAlert(
//           "PENALTY SYSTEM", 
//           `You failed to complete daily quests for ${missedDays} day(s).\n\nPUNISHMENT: -${penaltyXP} XP.\n${user.level < (JSON.parse(await AsyncStorage.getItem('userData') || '{}').level || user.level) ? 'YOUR LEVEL HAS DECREASED.' : ''}`
//         );
        
//         await AsyncStorage.setItem('userData', JSON.stringify(user));
//     }

//     return user;
//   };

//   // UI Updater for Music Slider
//   useEffect(() => {
//     let interval: NodeJS.Timeout;
//     if (sound && isPlaying) {
//       interval = setInterval(async () => {
//         try {
//             const status = await sound.getStatusAsync();
//             if (status.isLoaded) {
//                 setPosition(status.positionMillis / 1000);
//                 setDuration(status.durationMillis ? status.durationMillis / 1000 : 1);
//             }
//         } catch (e) {}
//       }, 1000);
//     }
//     return () => clearInterval(interval);
//   }, [sound, isPlaying]);

//   const handleAutoNext = async (currentSound: Audio.Sound) => {
//     const list = playlistRef.current;
//     const curr = currentTrackRef.current;
//     const mode = playbackModeRef.current;

//     if (!curr || list.length === 0) return;

//     if (mode === 'loop_one') {
//       await currentSound.replayAsync();
//     } 
//     else if (mode === 'play_one') {
//       setIsPlaying(false); setPosition(0);
//       await currentSound.stopAsync();
//       await currentSound.setPositionAsync(0);
//     } 
//     else if (mode === 'play_all') {
//       const idx = list.findIndex(t => t.id === curr.id);
//       if (idx !== -1 && idx < list.length - 1) {
//         playTrack(list[idx + 1]);
//       } else {
//         setIsPlaying(false); setPosition(0);
//         await currentSound.stopAsync();
//         await currentSound.setPositionAsync(0);
//       }
//     } 
//     else if (mode === 'loop_all') {
//       const idx = list.findIndex(t => t.id === curr.id);
//       const nextIdx = (idx + 1) % list.length;
//       playTrack(list[nextIdx]);
//     }
//   };

//   const saveUserData = async (data: UserData) => {
//     await AsyncStorage.setItem('userData', JSON.stringify(data));
//     setUserData(data);
//   };

//   const updateCustomPrograms = async (programs: CustomProgram[]) => {
//       setCustomPrograms(programs);
//       await AsyncStorage.setItem('customPrograms', JSON.stringify(programs));
//   };

//   // --- Music Controls ---
//   const playTrack = async (track: MusicTrack) => {
//     if (musicLoading) return;
    
//     // Prevent re-creating player if user taps the playing song
//     if (currentTrack?.id === track.id && sound) {
//         const status = await sound.getStatusAsync();
//         if(status.isLoaded && !status.isPlaying) {
//              await sound.playAsync();
//              setIsPlaying(true);
//              return;
//         }
//     }

//     try {
//       setMusicLoading(true);
      
//       // Release old player safely
//       if (sound) { 
//           await sound.unloadAsync();
//           setSound(null);
//       }

//       const source = track.isLocal ? track.path : { uri: track.path };
//       const mode = playbackModeRef.current;
//       const shouldLoop = mode === 'loop_one';
      
//       const { sound: newSound } = await Audio.Sound.createAsync(
//           source,
//           { shouldPlay: true, isLooping: shouldLoop }
//       );

//       newSound.setOnPlaybackStatusUpdate((status) => {
//          if (status.isLoaded && status.didJustFinish && !status.isLooping) {
//             handleAutoNext(newSound);
//          }
//       });

//       if (isMuted) await newSound.setIsMutedAsync(true);

//       setSound(newSound); 
//       setCurrentTrack(track); 
//       setIsPlaying(true);
      
//       setMusicLoading(false);
//     } catch (error) {
//       console.log('Play Error', error);
//       setMusicLoading(false);
//       showAlert('Error', 'Could not play audio track.');
//     }
//   };

//   const togglePlayPause = async () => {
//     if (!sound) { 
//         if (playlist.length > 0) playTrack(playlist[0]); 
//         return; 
//     }
//     if (musicLoading) return;
    
//     if (isPlaying) { 
//         await sound.pauseAsync(); 
//         setIsPlaying(false); 
//     } else { 
//         await sound.playAsync(); 
//         setIsPlaying(true); 
//     }
//   };

//   const seekTrack = async (value: number) => {
//     if (sound && !musicLoading) { 
//         await sound.setPositionAsync(value * 1000);
//         setPosition(value); 
//     }
//   };

//   const skipToNext = () => {
//     if (!currentTrack || playlist.length === 0) return;
//     const idx = playlist.findIndex(t => t.id === currentTrack.id);
//     const nextIdx = (idx + 1) % playlist.length;
//     playTrack(playlist[nextIdx]);
//   };

//   const skipToPrev = () => {
//     if (!currentTrack || playlist.length === 0) return;
//     const idx = playlist.findIndex(t => t.id === currentTrack.id);
//     const prevIdx = idx === 0 ? playlist.length - 1 : idx - 1;
//     playTrack(playlist[prevIdx]);
//   };

//   const deleteTrack = async (trackId: string) => {
//     if (trackId === 'default_ost') return;
//     if (currentTrack?.id === trackId) { 
//         if (sound) await sound.unloadAsync();
//         setSound(null);
//         setCurrentTrack(null);
//         setIsPlaying(false); 
//     }
//     const newList = playlist.filter(t => t.id !== trackId);
//     setPlaylist(newList);
//     AsyncStorage.setItem('musicPlaylist', JSON.stringify(newList));
//   };

//   const addMusicFile = async () => {
//     try {
//       const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
//       if (!result.canceled && result.assets && result.assets.length > 0) {
//         const file = result.assets[0];
//         const newTrack: MusicTrack = { id: Date.now().toString(), title: file.name, path: file.uri, isLocal: false, isFavorite: false };
//         const newList = [...playlist, newTrack];
//         setPlaylist(newList);
//         AsyncStorage.setItem('musicPlaylist', JSON.stringify(newList));
//       }
//     } catch (e) { showAlert('Error', 'Failed to pick audio file'); }
//   };

//   // --- Mini Player ---
//   const MiniPlayer = () => {
//     if (!currentTrack) return null;
//     return (
//       <TouchableOpacity activeOpacity={0.9} onPress={() => navigateTo('music')} style={styles.miniPlayerContainer}>
//          <View style={styles.miniProgressContainer}><View style={[styles.miniProgressFill, { width: `${(position / (duration || 1)) * 100}%` }]} /></View>
//          <View style={styles.miniPlayerContent}>
//             <View style={styles.miniInfo}>
//                {currentTrack.artwork ? ( <Image source={{ uri: currentTrack.artwork }} style={styles.miniArt} /> ) : ( <Ionicons name="musical-note" size={20} color={COLORS.blue} style={{marginRight: 10}} /> )}
//                <View><Text style={styles.miniTitle} numberOfLines={1}>{currentTrack.title}</Text><Text style={styles.miniTime}>{formatTime(position)} / {formatTime(duration)}</Text></View>
//             </View>
//             <View style={styles.miniControls}>
//                <TouchableOpacity onPress={(e) => { e.stopPropagation(); skipToPrev(); }} style={styles.miniCtrlBtn}><Ionicons name="play-skip-back" size={20} color={COLORS.text} /></TouchableOpacity>
//                <TouchableOpacity onPress={(e) => { e.stopPropagation(); togglePlayPause(); }} style={styles.miniCtrlBtn}><Ionicons name={isPlaying ? "pause" : "play"} size={26} color={COLORS.white} /></TouchableOpacity>
//                <TouchableOpacity onPress={(e) => { e.stopPropagation(); skipToNext(); }} style={styles.miniCtrlBtn}><Ionicons name="play-skip-forward" size={20} color={COLORS.text} /></TouchableOpacity>
//             </View>
//          </View>
//       </TouchableOpacity>
//     );
//   };

//   // --- Render Current Screen ---
//   const renderScreen = () => {
//     if (!userData && screen !== 'loading' && screen !== 'setup') return <LoadingScreen />;

//     switch (screen) {
//       case 'loading': return <LoadingScreen />;
//       case 'setup': 
//         return <SetupScreen onComplete={(data) => { setUserData(data); setScreenState('assessment'); }} />;
//       case 'assessment':
//         return <AssessmentScreen userData={userData!} onComplete={(stats, calculatedLevel) => {
//             const finalData = { ...userData!, level: calculatedLevel, assessmentStats: stats, createdAt: new Date().toISOString(), lastDailyQuestCompleted: getISODate(new Date()) };
//             saveUserData(finalData);
//             navigateTo('dashboard');
//         }} />;
//       case 'dashboard': 
//         return <DashboardScreen userData={userData!} onNavigate={navigateTo} onStartQuest={() => navigateTo('quest')} />;
//       case 'quest': 
//         return <QuestScreen 
//           userData={userData!} 
//           customPrograms={customPrograms}
//           onBack={() => navigateTo('dashboard')}
//           onStartTraining={(quest) => { setCurrentQuest(quest); setIsTraining(true); navigateTo('training'); }}
//         />;
//       case 'training':
//         return <TrainingScreen 
//           userData={userData!} 
//           quest={currentQuest!} 
//           showAlert={showAlert} // Passing alert handler
//           onComplete={(results, duration) => { updateProgress(results, duration); navigateTo('dashboard'); }}
//           onBack={() => { 
//             showAlert("Abort Mission?", "Stop training?", [
//               { text: "Cancel", style: "cancel" }, 
//               { text: "Quit", style: "destructive", onPress: () => navigateTo('dashboard') }
//             ]); 
//           }}
//         />;
//       case 'stats': return <StatsScreen userData={userData!} onBack={() => navigateTo('dashboard')} />;
//       case 'music': return <MusicScreen 
//           playlist={playlist} currentTrack={currentTrack} isPlaying={isPlaying} isLoading={musicLoading}
//           position={position} duration={duration} playbackMode={playbackMode}
//           onPlay={playTrack} onPause={togglePlayPause} onSeek={seekTrack} onNext={skipToNext} onPrev={skipToPrev} onDelete={deleteTrack} onAdd={addMusicFile}
//           onToggleMode={async () => {
//             const modes: PlaybackMode[] = ['loop_all', 'play_all', 'loop_one', 'play_one'];
//             const nextMode = modes[(modes.indexOf(playbackMode) + 1) % modes.length];
//             setPlaybackMode(nextMode);
//             // Sync current player native loop property
//             if(sound) await sound.setIsLoopingAsync(nextMode === 'loop_one');
//           }}
//           onBack={() => navigateTo('dashboard')} 
//         />;
//       case 'programs': return <CustomProgramsScreen 
//           userData={userData!} 
//           customPrograms={customPrograms}
//           setCustomPrograms={updateCustomPrograms}
//           onBack={() => navigateTo('dashboard')} 
//           onStartProgram={(quest) => { setCurrentQuest(quest); setIsTraining(true); navigateTo('training'); }}
//           showAlert={showAlert}
//         />;
//       case 'settings': return <SettingsScreen userData={userData!} onSave={(data) => { saveUserData(data); navigateTo('dashboard'); }} onBack={() => navigateTo('dashboard')} />;
//       default: return <LoadingScreen />;
//     }
//   };

//   const updateProgress = async (results: TrainingResult, duration: number) => {
//     try {
//       let xpGained = 0;
//       if (currentQuest?.isDaily) {
//           xpGained = currentQuest.rewards.xp;
//           const todayStr = getISODate(new Date());
//           userData!.lastDailyQuestCompleted = todayStr;
//       } else {
//           xpGained = 100;
//       }

//       const history = await AsyncStorage.getItem('trainingHistory');
//       const parsed: TrainingHistory[] = history ? JSON.parse(history) : [];
//       const newEntry: TrainingHistory = { date: new Date().toISOString(), quest: currentQuest!, results: results, xpGained: xpGained, durationSeconds: duration };
//       parsed.push(newEntry);
//       await AsyncStorage.setItem('trainingHistory', JSON.stringify(parsed));

//       const xpNeeded = userData!.level * XP_PER_LEVEL_BASE;
//       let newTotalXP = userData!.xp + xpGained;
//       let newLevel = userData!.level;
//       let leveledUp = false;

//       while (newTotalXP >= xpNeeded) {
//         newTotalXP -= xpNeeded;
//         newLevel++;
//         leveledUp = true;
//       }

//       const newUserData: UserData = {
//         ...userData!, xp: newTotalXP, level: newLevel, totalWorkouts: (userData!.totalWorkouts || 0) + 1,
//       };
      
//       if (leveledUp) {
//         showAlert('LEVEL UP!', `You have reached Level ${newLevel}!`);
//       } else {
//         showAlert('QUEST COMPLETED', `You gained ${xpGained} Experience Points.`);
//       }
//       saveUserData(newUserData);
//     } catch (error) { console.error('Error updating progress:', error); }
//   };

//   // return (
//   //   <SafeAreaProvider>
//   //       <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
//   //       <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} translucent={false} />
//   //       <View style={{ flex: 1, paddingBottom: (currentTrack && screen !== 'music') ? 70 : 0 }}>{renderScreen()}</View>
//   //       {currentTrack && screen !== 'music' && <MiniPlayer />}
//   //       <CustomAlert visible={alertState.visible} title={alertState.title} message={alertState.message} buttons={alertState.buttons} onClose={closeAlert} />
//   //       </SafeAreaView>
//   //   </SafeAreaProvider>
//   // );
//   return (
//   <SafeAreaProvider>
//     <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
//       <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} translucent={false} />
      
//       {/* Main content - takes remaining space */}
//       <View style={{ flex: 1 }}>
//         {renderScreen()}
//       </View>
      
//       {/* Mini player - natural bottom position */}
//       {currentTrack && screen !== 'music' && <MiniPlayer />}
      
//       <CustomAlert {...alertState} onClose={closeAlert} />
//     </SafeAreaView>
//   </SafeAreaProvider>
// );
// }

// // --- Screens ---

// function LoadingScreen() {
//   const spinValue = useRef(new Animated.Value(0)).current;
//   useEffect(() => { Animated.loop(Animated.timing(spinValue, { toValue: 1, duration: 2000, useNativeDriver: true })).start(); }, []);
//   const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
//   return (
//     <View style={styles.centerContainer}>
//       <Animated.View style={{ transform: [{ rotate: spin }], marginBottom: 20 }}><Ionicons name="reload-circle-outline" size={60} color={COLORS.blue} /></Animated.View>
//       <Text style={styles.loadingTitle}>SOLO LEVELING</Text><Text style={styles.loadingSubtitle}>INITIALIZING SYSTEM...</Text>
//     </View>
//   );
// }

// function SetupScreen({ onComplete }: { onComplete: (data: UserData) => void }) {
//   const [formData, setFormData] = useState<any>({ name: '', level: 1, sex: 'male', weight: '', height: '', goal: 'muscle' });
//   const [image, setImage] = useState<string | null>(null);
//   const pickImage = async () => {
//     let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5 });
//     if (!result.canceled) setImage(result.assets[0].uri);
//   };
//   const handleNext = () => {
//     if (!formData.name) return;
//     onComplete({ ...formData, weight: parseFloat(formData.weight) || 70, height: parseFloat(formData.height) || 170, xp: 0, totalWorkouts: 0, createdAt: new Date().toISOString(), cameraEnabled: false, profileImage: image || undefined });
//   };
//   const GoalButton = ({ type, icon, label }: { type: GoalType, icon: string, label: string }) => (
//     <TouchableOpacity style={[styles.goalBtn, formData.goal === type && styles.goalBtnActive]} onPress={() => setFormData({...formData, goal: type})}>
//         <MaterialCommunityIcons name={icon as any} size={24} color={formData.goal === type ? COLORS.white : COLORS.blue} />
//         <Text style={formData.goal === type ? styles.goalTextActive : styles.goalText}>{label}</Text>
//     </TouchableOpacity>
//   );
//   return (
//     <ScrollView style={styles.screenContainer} contentContainerStyle={{padding: 20}} showsVerticalScrollIndicator={false}>
//       <Text style={styles.headerTitle}>PLAYER REGISTRATION</Text>
//       <TouchableOpacity onPress={pickImage} style={styles.avatarPicker}>
//         {image ? ( <Image source={{ uri: image }} style={styles.avatarImage} /> ) : ( <View style={styles.avatarPlaceholder}><Ionicons name="camera" size={40} color={COLORS.textDark} /><Text style={styles.avatarText}>ADD PHOTO</Text></View> )}
//       </TouchableOpacity>
//       <View style={styles.formGroup}><Text style={styles.label}>HUNTER NAME</Text><TextInput style={styles.input} placeholder="Enter Name" placeholderTextColor={COLORS.textDark} onChangeText={t => setFormData({...formData, name: t})} /></View>
//       <View style={styles.formGroup}><Text style={styles.label}>GOAL / CLASS</Text><GoalButton type="muscle" icon="arm-flex" label="Muscle & Strength" /><GoalButton type="weight_loss" icon="run-fast" label="Weight Loss" /><GoalButton type="speed_strength" icon="flash" label="Speed & Strength (Assassin)" /></View>
//       <View style={styles.formGroup}><Text style={styles.label}>GENDER</Text><View style={styles.genderContainer}><TouchableOpacity style={[styles.genderBtn, formData.sex === 'male' && styles.genderBtnActive]} onPress={() => setFormData({...formData, sex: 'male'})}><Ionicons name="male" size={20} color={formData.sex === 'male' ? COLORS.white : COLORS.blue} /><Text style={formData.sex === 'male' ? styles.genderTextActive : styles.genderText}>MALE</Text></TouchableOpacity><TouchableOpacity style={[styles.genderBtn, formData.sex === 'female' && styles.genderBtnActive]} onPress={() => setFormData({...formData, sex: 'female'})}><Ionicons name="female" size={20} color={formData.sex === 'female' ? COLORS.white : COLORS.blue} /><Text style={formData.sex === 'female' ? styles.genderTextActive : styles.genderText}>FEMALE</Text></TouchableOpacity></View></View>
//       <View style={styles.row}><View style={[styles.formGroup, {flex:1, marginRight: 10}]}><Text style={styles.label}>WEIGHT (KG)</Text><TextInput style={styles.input} keyboardType="numeric" onChangeText={t => setFormData({...formData, weight: t})} /></View><View style={[styles.formGroup, {flex:1}]}><Text style={styles.label}>HEIGHT (CM)</Text><TextInput style={styles.input} keyboardType="numeric" onChangeText={t => setFormData({...formData, height: t})} /></View></View>
//       <TouchableOpacity style={styles.mainButton} onPress={handleNext}><Text style={styles.mainButtonText}>PROCEED TO EVALUATION</Text></TouchableOpacity>
//     </ScrollView>
//   );
// }

// function AssessmentScreen({ userData, onComplete }: { userData: UserData, onComplete: (stats: any, level: number) => void }) {
//     const [step, setStep] = useState<'intro' | 'active' | 'rest' | 'input'>('intro');
//     const [currentExIndex, setCurrentExIndex] = useState(0);
//     const [timer, setTimer] = useState(0);
//     const [reps, setReps] = useState('');
//     const [results, setResults] = useState<{[key:string]: number}>({});

//     const getExercises = () => {
//         if (userData.goal === 'speed_strength') return ['pushups', 'jumpSquats', 'lunges']; 
//         else if (userData.goal === 'weight_loss') return ['squats', 'situps', 'lunges']; 
//         else return ['pushups', 'squats', 'situps']; 
//     };

//     const exercises = getExercises();
//     const currentEx = exercises[currentExIndex];
//     const EX_TIME = 60; const REST_TIME = 15;

//     useEffect(() => {
//         let interval: NodeJS.Timeout;
//         if ((step === 'active' || step === 'rest') && timer > 0) {
//             interval = setInterval(() => {
//                 setTimer(prev => {
//                     if (prev <= 1) {
//                         if (step === 'active') { Vibration.vibrate(); setStep('input'); } 
//                         else if (step === 'rest') {
//                             if (currentExIndex < exercises.length - 1) { setCurrentExIndex(prevIdx => prevIdx + 1); startExercise(); } 
//                             else { finishAssessment(); }
//                         }
//                         return 0;
//                     }
//                     return prev - 1;
//                 });
//             }, 1000);
//         }
//         return () => clearInterval(interval);
//     }, [step, timer]);

//     const startExercise = () => { setTimer(EX_TIME); setStep('active'); setReps(''); };
//     const handleInput = () => {
//         const count = parseInt(reps) || 0;
//         setResults(prev => ({...prev, [currentEx]: count}));
//         if (currentExIndex < exercises.length - 1) { setTimer(REST_TIME); setStep('rest'); } 
//         else { finishAssessment(count); }
//     };

//     const finishAssessment = (lastReps?: number) => {
//         const finalResults = lastReps ? {...results, [currentEx]: lastReps} : results;
//         let totalReps = 0; Object.values(finalResults).forEach(val => totalReps += val);
//         const calculatedLevel = Math.max(1, Math.floor(totalReps / 40) + 1);
//         onComplete(finalResults, calculatedLevel);
//     };

//     return (
//         <View style={styles.centerContainer}>
//             <Text style={styles.headerTitle}>SYSTEM EVALUATION</Text>
//             {step === 'intro' && (
//                 <View style={{padding: 20, alignItems: 'center'}}>
//                     <Text style={styles.questTitleDark}>RANKING TEST</Text>
//                     <Text style={styles.alertMessage}>You will perform 3 exercises to determine your Hunter Rank. {"\n\n"}1 Minute MAX reps for each.{"\n"}15 Seconds rest between sets.</Text>
//                     {exercises.map(e => ( <View key={e} style={{flexDirection:'row', marginVertical: 5}}><SoloIcon name={EXERCISES[e].iconName} lib={EXERCISES[e].iconLib} color={COLORS.blue} /><Text style={{color: COLORS.text, marginLeft: 10}}>{EXERCISES[e].name}</Text></View> ))}
//                     <TouchableOpacity style={styles.mainButton} onPress={startExercise}><Text style={styles.mainButtonText}>START TEST</Text></TouchableOpacity>
//                 </View>
//             )}
//             {step === 'active' && (
//                 <View style={{alignItems: 'center'}}>
//                     <Text style={styles.loadingSubtitle}>CURRENT EXERCISE</Text><Text style={styles.loadingTitle}>{EXERCISES[currentEx].name}</Text>
//                     <View style={styles.timerCircle}><Text style={styles.timerText}>{timer}</Text></View><Text style={styles.label}>DO AS MANY AS YOU CAN</Text>
//                 </View>
//             )}
//             {step === 'input' && (
//                 <View style={{alignItems: 'center', width: '80%'}}>
//                     <Text style={styles.questTitleDark}>TIME'S UP</Text><Text style={styles.label}>ENTER REPS COMPLETED:</Text>
//                     <TextInput style={[styles.input, {textAlign: 'center', fontSize: 24, width: 100}]} keyboardType="numeric" value={reps} onChangeText={setReps} autoFocus />
//                     <TouchableOpacity style={styles.mainButton} onPress={handleInput}><Text style={styles.mainButtonText}>CONFIRM</Text></TouchableOpacity>
//                 </View>
//             )}
//             {step === 'rest' && (
//                 <View style={{alignItems: 'center'}}>
//                     <Text style={styles.loadingTitle}>REST</Text><Text style={styles.timerText}>{timer}</Text><Text style={styles.loadingSubtitle}>NEXT: {EXERCISES[exercises[currentExIndex + 1]]?.name}</Text>
//                 </View>
//             )}
//         </View>
//     );
// }

// function DashboardScreen({ userData, onNavigate, onStartQuest }: any) {
//   if (!userData) return null;
//   const xpPercent = (userData.xp / (userData.level * XP_PER_LEVEL_BASE)) * 100;
//   return (
//     <ScrollView style={styles.screenContainer} showsVerticalScrollIndicator={false}>
//       <View style={styles.dashboardHeader}>
//         <View style={styles.profileRow}>
//           <Image source={userData.profileImage ? { uri: userData.profileImage } : { uri: 'https://via.placeholder.com/150' }} style={styles.profileImageSmall} />
//           <View><Text style={styles.playerName}>{userData.name}</Text><Text style={styles.playerRank}>LEVEL {userData.level}</Text><Text style={{color: COLORS.gold, fontSize: 10, letterSpacing: 1}}>CLASS: {userData.goal.replace('_', ' ').toUpperCase()}</Text></View>
//         </View>
//       </View>
//       <View style={styles.systemWindow}>
//         <Text style={styles.systemHeader}>STATUS</Text>
//         <View style={styles.xpBarContainer}><View style={[styles.xpBarFill, { width: `${xpPercent}%` }]} /></View>
//         <Text style={styles.xpText}>{userData.xp} / {userData.level * XP_PER_LEVEL_BASE} XP</Text>
//         <View style={styles.statGrid}>
//           <View style={styles.statItem}><Ionicons name="barbell-outline" size={20} color={COLORS.blue} /><Text style={styles.statVal}>{userData.totalWorkouts}</Text><Text style={styles.statLbl}>Raids</Text></View>
//           <View style={styles.statItem}><MaterialCommunityIcons name="fire" size={20} color={COLORS.danger} /><Text style={styles.statVal}>{userData.level}</Text><Text style={styles.statLbl}>Rank</Text></View>
//         </View>
//       </View>
//       <View style={styles.menuGrid}>
//         <TouchableOpacity style={styles.menuCardLarge} onPress={onStartQuest}>
//            <MaterialCommunityIcons name="sword-cross" size={40} color={COLORS.gold} /><Text style={styles.menuTitle}>DAILY QUEST</Text><Text style={styles.menuSub}>{userData.lastDailyQuestCompleted === getISODate(new Date()) ? 'Completed' : 'Available'}</Text>
//         </TouchableOpacity>
//         <View style={styles.menuRow}>
//            <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('programs')}><Ionicons name="list" size={24} color={COLORS.blue} /><Text style={styles.menuTitleSmall}>Programs</Text></TouchableOpacity>
//            <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('stats')}><Ionicons name="stats-chart" size={24} color={COLORS.success} /><Text style={styles.menuTitleSmall}>Stats</Text></TouchableOpacity>
//         </View>
//         <View style={styles.menuRow}>
//            <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('music')}><Ionicons name="musical-notes" size={24} color={COLORS.purple} /><Text style={styles.menuTitleSmall}>Music</Text></TouchableOpacity>
//            <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('settings')}><Ionicons name="settings" size={24} color={COLORS.textDark} /><Text style={styles.menuTitleSmall}>Settings</Text></TouchableOpacity>
//         </View>
//       </View>
//     </ScrollView>
//   );
// }

// function MusicScreen({ playlist, currentTrack, isPlaying, isLoading, position, duration, playbackMode, onPlay, onPause, onSeek, onNext, onPrev, onDelete, onAdd, onToggleMode, onBack }: any) {
//   const [searchQuery, setSearchQuery] = useState('');
//   const getModeIcon = () => {
//     switch(playbackMode) {
//       case 'loop_one': return 'repeat-once';
//       case 'loop_all': return 'repeat';
//       case 'play_one': return 'numeric-1-box-outline';
//       case 'play_all': return 'playlist-play';
//       default: return 'repeat';
//     }
//   };
//   const filteredPlaylist = playlist.filter((track: MusicTrack) => track.title.toLowerCase().includes(searchQuery.toLowerCase()));

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}>
//         <TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>MUSIC PLAYER</Text>
//         <TouchableOpacity onPress={onToggleMode} style={styles.modeBtnHeader}><MaterialCommunityIcons name={getModeIcon()} size={20} color={COLORS.blue} /></TouchableOpacity>
//       </View>
//       <View style={styles.playerMain}>
//         {currentTrack && currentTrack.artwork ? ( <Image source={{uri: currentTrack.artwork}} style={styles.albumArt} /> ) : ( <View style={styles.albumArtPlaceholder}><Ionicons name="musical-note" size={80} color={COLORS.highlight} /></View> )}
//         <Text style={styles.nowPlayingTitle} numberOfLines={1}>{currentTrack ? currentTrack.title : 'Select a Track'}</Text>
//         <View style={styles.seekContainer}>
//           <Text style={styles.timeText}>{formatTime(position)}</Text>
//           <Slider style={{flex: 1, marginHorizontal: 10}} minimumValue={0} maximumValue={duration > 0 ? duration : 1} value={position} minimumTrackTintColor={COLORS.highlight} maximumTrackTintColor={COLORS.accent} thumbTintColor={COLORS.blue} onSlidingComplete={onSeek} />
//           <Text style={styles.timeText}>{formatTime(duration)}</Text>
//         </View>
//         <View style={styles.playerControlsMain}>
//            <TouchableOpacity onPress={onPrev} style={styles.ctrlBtn}><Ionicons name="play-skip-back" size={30} color={COLORS.text} /></TouchableOpacity>
//            <TouchableOpacity onPress={onPause} style={styles.playButtonLarge}>{isLoading ? ( <View style={{width: 30, height: 30, borderWidth: 3, borderRadius: 15, borderColor: COLORS.primary, borderTopColor: COLORS.blue}} /> ) : ( <Ionicons name={isPlaying ? "pause" : "play"} size={40} color={COLORS.primary} /> )}</TouchableOpacity>
//            <TouchableOpacity onPress={onNext} style={styles.ctrlBtn}><Ionicons name="play-skip-forward" size={30} color={COLORS.text} /></TouchableOpacity>
//         </View>
//       </View>
//       <View style={styles.playlistHeader}><Text style={styles.sectionTitle}>PLAYLIST</Text><TouchableOpacity onPress={onAdd} style={styles.addBtn}><Ionicons name="add" size={20} color={COLORS.primary} /></TouchableOpacity></View>
//       <View style={{paddingHorizontal: 20, marginBottom: 5}}><View style={styles.searchContainer}><Ionicons name="search" size={20} color={COLORS.textDark} /><TextInput style={styles.searchInput} placeholder="Search tracks..." placeholderTextColor={COLORS.textDark} value={searchQuery} onChangeText={setSearchQuery} /></View></View>
//       <ScrollView style={styles.playlistContainer} showsVerticalScrollIndicator={false}>
//         {filteredPlaylist.map((track: MusicTrack) => (
//           <View key={track.id} style={[styles.trackRow, currentTrack?.id === track.id && styles.trackActive]}>
//             <TouchableOpacity style={styles.trackInfoArea} onPress={() => onPlay(track)}>
//               <View style={styles.trackIcon}><Ionicons name="musical-notes-outline" size={20} color={currentTrack?.id === track.id ? COLORS.white : COLORS.textDark} /></View>
//               <Text style={[styles.trackName, currentTrack?.id === track.id && styles.trackNameActive]} numberOfLines={1}>{track.title}</Text>
//             </TouchableOpacity>
//             <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(track.id)}><Ionicons name="trash-outline" size={18} color={COLORS.danger} /></TouchableOpacity>
//           </View>
//         ))}
//       </ScrollView>
//     </View>
//   );
// }

// function TrainingScreen({ userData, quest, onComplete, onBack, showAlert }: any) {
//   const [counts, setCounts] = useState<TrainingResult>({});
//   const [permission, requestPermission] = useCameraPermissions();
//   const [cameraType, setCameraType] = useState('front'); 
//   const [workoutTime, setWorkoutTime] = useState(0);
//   const [activeExercise, setActiveExercise] = useState<string | null>(null);
//   const [manualInputs, setManualInputs] = useState<{[key:string]: string}>({});
  
//   const cameraRef = useRef<any>(null);

//   useEffect(() => {
//     if (!permission) requestPermission();
//     const initCounts: any = {}; Object.keys(quest.exercises).forEach(k => initCounts[k] = 0); setCounts(initCounts);
//   }, [permission]);

//   // Workout Timer
//   useEffect(() => {
//     const timer = setInterval(() => {
//         setWorkoutTime(t => t + 1);
//     }, 1000);
//     return () => clearInterval(timer);
//   }, []);

//   const handleManualAdd = (ex: string, target: number) => { 
//       const amount = parseInt(manualInputs[ex] || '0');
//       if (amount > 0) {
//           const current = counts[ex] || 0; 
//           const newVal = Math.min(current + amount, target);
//           setCounts({...counts, [ex]: newVal});
//           setManualInputs({...manualInputs, [ex]: ''});
//       }
//   };

//   const handleDecrease = (ex: string) => {
//       const current = counts[ex] || 0;
//       if (current > 0) setCounts({...counts, [ex]: current - 1});
//   };

//   const handleCheckAll = () => {
//     showAlert("Complete All?", "Mark all exercises as finished?", [
//         { text: "Cancel", style: "cancel" },
//         { text: "Yes", onPress: () => setCounts(quest.exercises) }
//     ]);
//   };

//   const isCompleted = (ex: string) => (counts[ex] || 0) >= quest.exercises[ex];
//   const allCompleted = Object.keys(quest.exercises).every(isCompleted);

//   // Determine if active exercise is supported by pose detection logic
//   const isPoseSupported = (exKey: string) => PoseCalculator.isSupported(exKey);

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}>
//         <TouchableOpacity onPress={onBack}><Ionicons name="close" size={24} color={COLORS.danger} /></TouchableOpacity>
//         <Text style={styles.headerTitle}>DUNGEON INSTANCE</Text>
//         <View style={styles.timerBadge}>
//              <Ionicons name="timer-outline" size={16} color={COLORS.gold} />
//              <Text style={styles.timerValue}>{formatTime(workoutTime)}</Text>
//         </View>
//         <TouchableOpacity onPress={() => setCameraType(cameraType === 'back' ? 'front' : 'back')}><Ionicons name="camera-reverse" size={24} color={COLORS.blue} /></TouchableOpacity>
//       </View>
      
//       {userData.cameraEnabled && (
//         <View style={styles.cameraContainer}>
//           {permission?.granted ? (
//             <CameraView style={styles.camera} facing={cameraType as any} ref={cameraRef}>
//                <View style={styles.cameraOverlay}>
//                   <Text style={styles.detectionText}>SYSTEM: POSE TRACKING ACTIVE</Text>
                  
//                   {activeExercise && !isPoseSupported(activeExercise) ? (
//                       <View style={styles.camWarningBox}>
//                           <Text style={styles.camWarningText}>CANNOT DETECT WITH CAM</Text>
//                       </View>
//                   ) : (
//                       <View style={styles.poseBox} />
//                   )}
  
//                   {activeExercise && isPoseSupported(activeExercise) && (
//                       <View style={styles.poseInfoBox}>
//                           <Text style={styles.poseInfoText}>Detecting: {EXERCISES[activeExercise]?.name || activeExercise}</Text>
//                           <Text style={styles.poseInfoSub}>Ensure full body visibility</Text>
//                       </View>
//                   )}
//                </View>
//             </CameraView>
//           ) : (
//              <View style={styles.cameraOff}>
//                  <Ionicons name="videocam-off" size={40} color={COLORS.textDark} />
//                  <Text style={styles.cameraOffText}>CAMERA DISABLED</Text>
//                  <Text style={styles.cameraOffSub}>Enable in Settings for Auto-Count</Text>
//              </View>
//           )}
//         </View>
//       )}

//       <ScrollView style={styles.exerciseList} contentContainerStyle={{paddingBottom: 20}} showsVerticalScrollIndicator={false}>
//         {Object.entries(quest.exercises).map(([key, target]: [string, any]) => {
//           const def = quest.customExercises?.[key] || EXERCISES[key] || { name: key, iconName: 'help', iconLib: 'Ionicons' };
//           const count = counts[key] || 0;
//           const completed = isCompleted(key);
          
//           return (
//             <TouchableOpacity 
//                 key={key} 
//                 style={[styles.exerciseCard, completed && styles.exerciseCardDone, activeExercise === key && styles.exerciseCardActive]}
//                 onPress={() => setActiveExercise(key)}
//             >
//               <View style={styles.exHeaderRow}>
//                  <View style={styles.exIcon}><SoloIcon name={def.iconName} lib={def.iconLib} size={28} color={COLORS.blue} /></View>
//                  <View style={{flex: 1}}>
//                     <Text style={styles.exName}>{def.name}</Text>
//                     <View style={styles.progressBarBg}><View style={[styles.progressBarFill, {width: `${Math.min((count/target)*100, 100)}%`}]} /></View>
//                  </View>
//                  <Text style={styles.countTextLarge}>{count}/{target}</Text>
//               </View>

//               <View style={styles.seriesControls}>
//                  <TouchableOpacity style={styles.seriesBtnSmall} onPress={() => handleDecrease(key)} disabled={count === 0}>
//                     <Ionicons name="remove" size={16} color={COLORS.white} />
//                  </TouchableOpacity>
                 
//                  <TextInput 
//                     style={styles.seriesInput} 
//                     placeholder="#" 
//                     placeholderTextColor={COLORS.textDark}
//                     keyboardType="numeric"
//                     value={manualInputs[key] || ''}
//                     onChangeText={(t) => setManualInputs({...manualInputs, [key]: t})}
//                  />
                 
//                  <TouchableOpacity style={styles.seriesBtn} onPress={() => handleManualAdd(key, target)} disabled={completed}>
//                     <Text style={styles.seriesBtnText}>ADD SET</Text>
//                  </TouchableOpacity>
                 
//                  <TouchableOpacity style={[styles.checkBtn, completed ? styles.checkBtnDone : {}]} onPress={() => setCounts({...counts, [key]: target})}>
//                     <Ionicons name="checkmark" size={18} color={COLORS.white} />
//                  </TouchableOpacity>
//               </View>
//             </TouchableOpacity>
//           );
//         })}
//         <TouchableOpacity style={styles.checkAllBtn} onPress={handleCheckAll}>
//             <Text style={styles.checkAllText}>COMPLETE ALL EXERCISES</Text>
//         </TouchableOpacity>
        
//         {allCompleted && ( <TouchableOpacity style={styles.completeBtn} onPress={() => onComplete(counts, workoutTime)}><Text style={styles.completeBtnText}>COMPLETE DUNGEON</Text></TouchableOpacity> )}
//       </ScrollView>
//     </View>
//   );
// }

// function CustomProgramsScreen({ userData, customPrograms, setCustomPrograms, onBack, onStartProgram, showAlert }: any) {
//   const [modalVisible, setModalVisible] = useState(false);
//   const [newProgName, setNewProgName] = useState('');
//   const [editingId, setEditingId] = useState<string | null>(null);
//   const [selectedEx, setSelectedEx] = useState<{[key:string]: number}>({});
//   const [customList, setCustomList] = useState<Array<{id: string, name: string, reps: number}>>([]);
//   const [customExName, setCustomExName] = useState('');
//   const [customExCount, setCustomExCount] = useState('10');
//   const [schedule, setSchedule] = useState<string[]>([]); // New schedule state

//   const toggleExercise = (key: string) => { const next = {...selectedEx}; if (next[key]) delete next[key]; else next[key] = 10; setSelectedEx(next); };
//   const updateReps = (key: string, val: string) => { const next = {...selectedEx, [key]: parseInt(val) || 0}; setSelectedEx(next); };

//   const addCustomExercise = () => {
//     if (!customExName) { showAlert("Error", "Enter name"); return; }
//     const newEx = { id: `cust_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, name: customExName, reps: parseInt(customExCount) || 10 };
//     setCustomList([...customList, newEx]); setCustomExName(''); setCustomExCount('10');
//   };

//   const removeCustomExercise = (id: string) => { setCustomList(customList.filter(item => item.id !== id)); };

//   const toggleDay = (day: string) => {
//       if (schedule.includes(day)) setSchedule(schedule.filter(d => d !== day));
//       else setSchedule([...schedule, day]);
//   };

//   const openCreateModal = () => {
//     setNewProgName(''); setEditingId(null); setSelectedEx({}); setCustomList([]); setSchedule([]); setModalVisible(true);
//   };

//   const openEditModal = (prog: CustomProgram) => {
//     setNewProgName(prog.name); setEditingId(prog.id); setSchedule(prog.schedule || []);
//     const stdEx: {[key:string]: number} = {}; const cList: Array<{id: string, name: string, reps: number}> = [];
//     Object.entries(prog.exercises).forEach(([key, reps]) => {
//         if(EXERCISES[key]) stdEx[key] = reps;
//         else if (prog.customExercises && prog.customExercises[key]) cList.push({ id: key, name: prog.customExercises[key].name, reps: reps });
//     });
//     setSelectedEx(stdEx); setCustomList(cList); setModalVisible(true);
//   };

//   const saveProgram = () => {
//     if (!newProgName) { showAlert("Error", "Name required"); return; }
//     let customDefs: ExerciseConfig = {}; let finalExercises = { ...selectedEx };
//     customList.forEach(item => { customDefs[item.id] = { name: item.name, iconName: 'star', iconLib: 'Ionicons', custom: true, type: 'reps' }; finalExercises[item.id] = item.reps; });
//     const newProg: CustomProgram = { id: editingId ? editingId : Date.now().toString(), name: newProgName, exercises: finalExercises, customExercises: customDefs, schedule: schedule, createdAt: new Date().toISOString() };
//     let updated; if(editingId) updated = customPrograms.map((p: any) => p.id === editingId ? newProg : p); else updated = [...customPrograms, newProg];
//     setCustomPrograms(updated); setModalVisible(false);
//   };

//   const deleteProgram = (id: string) => { const updated = customPrograms.filter((p: any) => p.id !== id); setCustomPrograms(updated); };

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}>
//         <TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>CUSTOM PROGRAMS</Text>
//         <TouchableOpacity onPress={openCreateModal}><Ionicons name="add-circle" size={30} color={COLORS.blue} /></TouchableOpacity>
//       </View>
//       <ScrollView style={{padding: 20}} showsVerticalScrollIndicator={false}>
//         {customPrograms.map((p: any) => (
//            <View key={p.id} style={styles.programCard}>
//               <View style={{flex: 1}}>
//                 <Text style={styles.progTitle}>{p.name}</Text>
//                 <Text style={styles.progSub}>{Object.keys(p.exercises).length} Exercises</Text>
//                 {p.schedule && p.schedule.length > 0 && <Text style={{color: COLORS.gold, fontSize: 10}}>Scheduled: {p.schedule.join(', ')}</Text>}
//               </View>
//               <TouchableOpacity style={styles.startBtnSmall} onPress={() => onStartProgram({ title: p.name, difficulty: 1, exercises: p.exercises, rewards: { xp: 100, title: 'Custom' }, customExercises: p.customExercises, isDaily: false })}>
//                  <Text style={styles.btnTextSmall}>START</Text>
//               </TouchableOpacity>
//               <TouchableOpacity style={styles.editProgBtn} onPress={() => openEditModal(p)}><Ionicons name="create-outline" size={20} color={COLORS.white} /></TouchableOpacity>
//               <TouchableOpacity style={styles.deleteProgBtn} onPress={() => deleteProgram(p.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger} /></TouchableOpacity>
//            </View>
//         ))}
//       </ScrollView>
//       <Modal visible={modalVisible} animationType="slide" transparent>
//         <View style={styles.modalOverlay}>
//            <View style={styles.createModal}>
//               <Text style={styles.modalTitle}>{editingId ? 'EDIT PROGRAM' : 'NEW PROGRAM'}</Text>
//               <TextInput style={styles.input} placeholder="Program Name" placeholderTextColor={COLORS.textDark} value={newProgName} onChangeText={setNewProgName} />
              
//               <Text style={[styles.label, {marginTop: 10}]}>Schedule as Daily Quest:</Text>
//               <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10}}>
//                   {WEEK_DAYS.map(day => (
//                       <TouchableOpacity key={day} onPress={() => toggleDay(day)} style={[styles.dayBtn, schedule.includes(day) && styles.dayBtnActive]}>
//                           <Text style={[styles.dayBtnText, schedule.includes(day) && {color: COLORS.white}]}>{day.charAt(0)}</Text>
//                       </TouchableOpacity>
//                   ))}
//               </View>

//               <ScrollView style={{height: 200, marginVertical: 10}} showsVerticalScrollIndicator={false}>
//                  {Object.entries(EXERCISES).map(([k, v]) => (
//                     <View key={k} style={styles.selectRowContainer}>
//                         <Text style={styles.rowLabel}>{v.name}</Text>
//                         <View style={{flexDirection:'row', alignItems:'center'}}>
//                           {selectedEx[k] ? ( <TextInput style={styles.repsInput} keyboardType="numeric" value={String(selectedEx[k])} onChangeText={(val) => updateReps(k, val)} /> ) : null}
//                           <TouchableOpacity style={[styles.checkboxBtn, selectedEx[k] ? styles.checkboxActive : {}]} onPress={() => toggleExercise(k)}><Ionicons name={selectedEx[k] ? "remove" : "add"} size={20} color={selectedEx[k] ? COLORS.white : COLORS.blue} /></TouchableOpacity>
//                         </View>
//                     </View>
//                  ))}
//                  {customList.length > 0 && <Text style={[styles.label, {marginTop: 15}]}>Added Custom:</Text>}
//                  {customList.map((item) => (
//                     <View key={item.id} style={styles.selectRowContainer}>
//                         <View style={{flex:1}}><Text style={styles.rowLabel}>{item.name} ({item.reps} reps)</Text></View>
//                         <TouchableOpacity style={styles.deleteBtn} onPress={() => removeCustomExercise(item.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger} /></TouchableOpacity>
//                     </View>
//                  ))}
//               </ScrollView>
              
//               <View style={{borderTopWidth: 1, borderTopColor: COLORS.accent, paddingTop: 10}}>
//                  <Text style={styles.label}>Add Custom Exercise:</Text>
//                  <View style={styles.row}>
//                     <TextInput style={[styles.input, {flex: 2, marginRight: 5}]} placeholder="Name" placeholderTextColor={COLORS.textDark} value={customExName} onChangeText={setCustomExName} />
//                     <TextInput style={[styles.input, {flex: 1, marginRight: 5}]} keyboardType="numeric" placeholder="Reps" placeholderTextColor={COLORS.textDark} value={customExCount} onChangeText={setCustomExCount} />
//                     <TouchableOpacity style={styles.addCustomBtn} onPress={addCustomExercise}><Ionicons name="add" size={24} color={COLORS.white} /></TouchableOpacity>
//                  </View>
//               </View>

//               <View style={[styles.row, {marginTop: 10}]}>
//                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}><Text style={styles.btnText}>CANCEL</Text></TouchableOpacity>
//                  <TouchableOpacity style={styles.saveBtn} onPress={saveProgram}><Text style={styles.btnText}>SAVE</Text></TouchableOpacity>
//               </View>
//            </View>
//         </View>
//       </Modal>
//     </View>
//   );
// }

// function StatsScreen({ userData, onBack }: any) {
//   const [data, setData] = useState<number[]>([0]);
//   useEffect(() => { 
//     AsyncStorage.getItem('trainingHistory').then(h => { 
//         if(h) { 
//             const history = JSON.parse(h); 
//             // Group by date (YYYY-MM-DD) and sum XP
//             const grouped: {[key: string]: number} = {};
//             history.forEach((entry: TrainingHistory) => {
//                 const dateKey = entry.date.split('T')[0];
//                 grouped[dateKey] = (grouped[dateKey] || 0) + entry.xpGained;
//             });
//             // Sort by date key to ensure order
//             const sortedKeys = Object.keys(grouped).sort();
//             const xpData = sortedKeys.map(k => grouped[k]);
            
//             // Slice last 6 or default to [0]
//             if(xpData.length > 0) setData(xpData.slice(-6));
//             else setData([0]);
//         } 
//     }); 
//   }, []);
  
//   return (
//     <ScrollView style={styles.screenContainer} showsVerticalScrollIndicator={false}>
//        <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>STATISTICS</Text><View style={{width: 24}} /></View>
//       <View style={{padding: 20}}>
//         <Text style={styles.sectionTitle}>XP GAIN HISTORY</Text>
//         <LineChart
//           data={{ labels: ["1", "2", "3", "4", "5", "6"], datasets: [{ data: data }] }}
//           width={width - 40} height={220} yAxisLabel="" yAxisSuffix=" XP"
//           chartConfig={{
//             backgroundColor: COLORS.secondary, backgroundGradientFrom: COLORS.secondary, backgroundGradientTo: COLORS.accent,
//             decimalPlaces: 0, color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`, labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
//             style: { borderRadius: 16 }, propsForDots: { r: "6", strokeWidth: "2", stroke: COLORS.glow }
//           }}
//           style={{ marginVertical: 8, borderRadius: 16 }}
//         />
//         <View style={styles.statBoxLarge}><Text style={styles.bigStat}>{userData.totalWorkouts}</Text><Text style={styles.bigStatLbl}>TOTAL DUNGEONS CLEARED</Text></View>
//       </View>
//     </ScrollView>
//   );
// }

// function QuestScreen({ userData, customPrograms, onBack, onStartTraining }: any) {
//    // Generate Quest based on Goal and Level AND Schedule
//    const getDailyQuest = (): Quest => {
//       const todayDay = getDayString(new Date());
      
//       // 1. Check for Scheduled Custom Program
//       const scheduledProg = customPrograms.find((p: CustomProgram) => p.schedule && p.schedule.includes(todayDay));
//       if (scheduledProg) {
//           // Calculate XP based on level scaling roughly (standard reward for daily)
//           return {
//               title: `DAILY: ${scheduledProg.name.toUpperCase()}`,
//               difficulty: Math.floor(userData.level / 5) + 1,
//               exercises: scheduledProg.exercises,
//               customExercises: scheduledProg.customExercises,
//               rewards: { xp: userData.level * 150, title: 'Hunter' }, // High reward for scheduled custom
//               isDaily: true
//           };
//       }

//       // 2. Fallback to Standard Logic
//       const level = userData.level;
//       let exercises: {[key:string]: number} = {};
//       let title = "DAILY QUEST";
//       let rewardXP = level * 100; // Base reward

//       if (userData.goal === 'speed_strength') {
//           title = "ASSASSIN TRAINING";
//           exercises = { clapPushups: Math.ceil(level * 5), jumpSquats: Math.ceil(level * 10), situps: Math.ceil(level * 10), running: Math.min(1 + (level * 0.2), 5) };
//       } else if (userData.goal === 'weight_loss') {
//           title = "ENDURANCE TRIAL";
//           exercises = { squats: level * 15, situps: level * 15, burpees: level * 5, running: Math.min(2 + (level * 0.5), 10) };
//       } else {
//           title = "STRENGTH TRAINING";
//           exercises = { pushups: level * 10, squats: level * 10, situps: level * 10, pullups: Math.ceil(level * 2) };
//       }

//       return { title, difficulty: Math.floor(level / 5) + 1, exercises, rewards: { xp: rewardXP, title: 'Hunter' }, isDaily: true };
//    };

//    const dailyQuest = getDailyQuest();

//    return (
//       <View style={styles.screenContainer}>
//          <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>QUEST INFO</Text><View style={{width: 24}} /></View>
//          <View style={styles.questPaperDark}>
//             <Text style={styles.questTitleDark}>{dailyQuest.title}</Text>
//             <Text style={styles.difficulty}>Rank: {'★'.repeat(dailyQuest.difficulty)}</Text>
//             <View style={styles.divider} />
//             <Text style={styles.objTitleDark}>OBJECTIVES:</Text>
//             {Object.entries(dailyQuest.exercises).map(([k, v]) => (
//                <View key={k} style={styles.objRow}>
//                   <View style={{flexDirection: 'row', alignItems: 'center'}}>
//                      <View style={{width: 6, height: 6, backgroundColor: COLORS.blue, marginRight: 8}} />
//                      <Text style={styles.objTextDark}>{(dailyQuest.customExercises?.[k]?.name) || EXERCISES[k]?.name || k}</Text>
//                   </View>
//                   <Text style={styles.objValDark}>{v} {EXERCISES[k]?.type === 'distance' ? 'km' : ''}</Text>
//                </View>
//             ))}
//             <View style={styles.divider} />
//             <Text style={styles.rewardTitleDark}>REWARDS:</Text>
//             <Text style={styles.rewardText}>+ {dailyQuest.rewards.xp} XP</Text>
//          </View>
//          <TouchableOpacity style={[styles.acceptBtn, userData.lastDailyQuestCompleted === getISODate(new Date()) ? {backgroundColor: COLORS.textDark} : {}]} disabled={userData.lastDailyQuestCompleted === getISODate(new Date())} onPress={() => onStartTraining(dailyQuest)}>
//             <Text style={styles.acceptBtnText}>{userData.lastDailyQuestCompleted === getISODate(new Date()) ? 'QUEST COMPLETE' : 'ACCEPT QUEST'}</Text>
//          </TouchableOpacity>
//       </View>
//    );
// }

// function SettingsScreen({ userData, onSave, onBack }: any) {
//   const [camEnabled, setCamEnabled] = useState(userData.cameraEnabled);
//   const [name, setName] = useState(userData.name);
//   const [image, setImage] = useState(userData.profileImage);
//   const pickImage = async () => { let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5 }); if (!result.canceled) setImage(result.assets[0].uri); };
//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>SYSTEM SETTINGS</Text><View style={{width:24}} /></View>
//       <ScrollView style={{padding: 20}} showsVerticalScrollIndicator={false}>
//          <View style={{alignItems: 'center', marginBottom: 20}}>
//             <TouchableOpacity onPress={pickImage}><Image source={image ? { uri: image } : { uri: 'https://via.placeholder.com/150' }} style={styles.settingsAvatar} /><View style={styles.editIconBadge}><Ionicons name="camera" size={14} color={COLORS.white} /></View></TouchableOpacity>
//             <Text style={[styles.label, {marginTop: 10}]}>EDIT HUNTER NAME</Text><TextInput style={[styles.input, {textAlign: 'center', width: '80%'}]} value={name} onChangeText={setName} placeholder="Hunter Name" placeholderTextColor={COLORS.textDark} />
//          </View>
//          <View style={styles.divider} />
//          <View style={styles.settingRow}><Text style={styles.settingText}>Enable Pose Detection (Camera)</Text><TouchableOpacity onPress={() => setCamEnabled(!camEnabled)}><Ionicons name={camEnabled ? "checkbox" : "square-outline"} size={28} color={COLORS.blue} /></TouchableOpacity></View>
//          <TouchableOpacity style={styles.settingsSaveBtn} onPress={() => onSave({...userData, cameraEnabled: camEnabled, name: name, profileImage: image})}><Text style={styles.settingsSaveBtnText}>SAVE CHANGES</Text></TouchableOpacity>
//       </ScrollView>
//     </View>
//   );
// }

// // --- Helpers ---
// const formatTime = (seconds: number) => {
//   const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60);
//   return `${m}:${s < 10 ? '0' : ''}${s}`;
// };

// // --- Styles ---
// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: COLORS.primary },
//   screenContainer: { flex: 1, backgroundColor: COLORS.primary },
//   centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.primary },
//   loadingTitle: { fontSize: 32, fontWeight: '900', color: COLORS.blue, letterSpacing: 4 },
//   loadingSubtitle: { color: COLORS.textDark, marginTop: 10, letterSpacing: 2 },
//   header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: COLORS.accent },
//   headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', letterSpacing: 1.5 },
//   timerBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: COLORS.gold },
//   timerValue: { color: COLORS.gold, fontWeight: 'bold', marginLeft: 5, fontSize: 12 },
//   avatarPicker: { alignSelf: 'center', marginVertical: 20 },
//   avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: COLORS.accent, justifyContent: 'center', alignItems: 'center', borderStyle: 'dashed', borderWidth: 1, borderColor: COLORS.textDark },
//   avatarImage: { width: 100, height: 100, borderRadius: 50 },
//   avatarText: { fontSize: 10, color: COLORS.textDark, marginTop: 5 },
//   formGroup: { marginBottom: 15 },
//   row: { flexDirection: 'row', justifyContent: 'space-between' },
//   label: { color: COLORS.blue, fontSize: 12, marginBottom: 5, fontWeight: 'bold' },
//   input: { backgroundColor: COLORS.secondary, color: COLORS.text, padding: 15, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent },
//   genderContainer: { flexDirection: 'row', justifyContent: 'space-between' },
//   genderBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15, backgroundColor: COLORS.secondary, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent, marginHorizontal: 5 },
//   genderBtnActive: { backgroundColor: COLORS.blue, borderColor: COLORS.glow },
//   genderText: { color: COLORS.blue, fontWeight: 'bold', marginLeft: 8 },
//   genderTextActive: { color: COLORS.white, fontWeight: 'bold', marginLeft: 8 },
//   goalBtn: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: COLORS.secondary, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent, marginBottom: 8 },
//   goalBtnActive: { backgroundColor: COLORS.blue, borderColor: COLORS.glow },
//   goalText: { color: COLORS.blue, fontWeight: 'bold', marginLeft: 15 },
//   goalTextActive: { color: COLORS.white, fontWeight: 'bold', marginLeft: 15 },
//   mainButton: { backgroundColor: COLORS.blue, padding: 18, borderRadius: 8, alignItems: 'center', marginTop: 20 },
//   mainButtonText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 16, letterSpacing: 2 },
//   dashboardHeader: { padding: 20, paddingTop: 10 },
//   profileRow: { flexDirection: 'row', alignItems: 'center' },
//   profileImageSmall: { width: 60, height: 60, borderRadius: 30, marginRight: 15, borderWidth: 2, borderColor: COLORS.blue },
//   playerName: { color: COLORS.text, fontSize: 22, fontWeight: 'bold' },
//   playerRank: { color: COLORS.glow, fontSize: 12, letterSpacing: 1 },
//   systemWindow: { margin: 20, padding: 20, backgroundColor: COLORS.secondary, borderRadius: 12, borderWidth: 1, borderColor: COLORS.blue },
//   systemHeader: { color: COLORS.text, textAlign: 'center', fontWeight: 'bold', marginBottom: 15 },
//   xpBarContainer: { height: 6, backgroundColor: COLORS.accent, borderRadius: 3, marginBottom: 5 },
//   xpBarFill: { height: '100%', backgroundColor: COLORS.blue, borderRadius: 3 },
//   xpText: { color: COLORS.textDark, fontSize: 10, textAlign: 'right', marginBottom: 15 },
//   statGrid: { flexDirection: 'row', justifyContent: 'space-around' },
//   statItem: { alignItems: 'center' },
//   statVal: { color: COLORS.text, fontSize: 18, fontWeight: 'bold' },
//   statLbl: { color: COLORS.textDark, fontSize: 10 },
//   menuGrid: { padding: 20 },
//   menuCardLarge: { backgroundColor: COLORS.accent, padding: 20, borderRadius: 12, alignItems: 'center', marginBottom: 15, borderWidth: 1, borderColor: COLORS.gold },
//   menuTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', marginTop: 10 },
//   menuSub: { color: COLORS.danger, fontSize: 12 },
//   menuRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
//   menuCardSmall: { backgroundColor: COLORS.secondary, width: '48%', padding: 15, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.accent },
//   menuTitleSmall: { color: COLORS.text, marginTop: 5, fontSize: 12 },
//   playerMain: { alignItems: 'center', padding: 20 },
//   albumArtPlaceholder: { width: 140, height: 140, backgroundColor: COLORS.secondary, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 15, borderWidth: 1, borderColor: COLORS.accent },
//   albumArt: { width: 140, height: 140, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: COLORS.accent },
//   nowPlayingTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', marginBottom: 10, textAlign: 'center' },
//   seekContainer: { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 15 },
//   timeText: { color: COLORS.textDark, fontSize: 10, width: 35, textAlign: 'center' },
//   playerControlsMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', width: '80%' },
//   playButtonLarge: { width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.blue, justifyContent: 'center', alignItems: 'center' },
//   ctrlBtn: { padding: 10 },
//   modeBtnHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, padding: 5, borderRadius: 5, borderWidth: 1, borderColor: COLORS.accent },
//   playlistHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginTop: 10 },
//   sectionTitle: { color: COLORS.blue, fontWeight: 'bold' },
//   addBtn: { backgroundColor: COLORS.highlight, padding: 5, borderRadius: 4 },
//   searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: COLORS.accent, marginTop: 10 },
//   searchInput: { flex: 1, color: COLORS.text, marginLeft: 10, paddingVertical: 5 },
//   playlistContainer: { padding: 20 },
//   trackRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.accent, justifyContent: 'space-between' },
//   trackActive: { backgroundColor: COLORS.accent },
//   trackInfoArea: { flexDirection: 'row', alignItems: 'center', flex: 1 },
//   trackIcon: { width: 30 },
//   trackName: { color: COLORS.textDark, flex: 1, fontSize: 14, marginLeft: 5 },
//   trackNameActive: { color: COLORS.white, fontWeight: 'bold', textShadowColor: COLORS.glow, textShadowRadius: 8 },
//   deleteBtn: { padding: 5 },
//   miniPlayerContainer: { position: 'relative', bottom: 0, left: 0, right: 0, height: 70, backgroundColor: COLORS.secondary, borderTopWidth: 1, borderTopColor: COLORS.blue, zIndex: 999 },
//   miniProgressContainer: { height: 2, backgroundColor: COLORS.accent, width: '100%' },
//   miniProgressFill: { height: '100%', backgroundColor: COLORS.highlight },
//   miniPlayerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, flex: 1 },
//   miniInfo: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 10 },
//   miniArt: { width: 40, height: 40, borderRadius: 4, marginRight: 10 },
//   miniTitle: { color: COLORS.white, fontWeight: 'bold', fontSize: 14 },
//   miniTime: { color: COLORS.textDark, fontSize: 10 },
//   miniControls: { flexDirection: 'row', alignItems: 'center' },
//   miniCtrlBtn: { marginHorizontal: 8 },
//   cameraContainer: { height: 250, backgroundColor: '#000', overflow: 'hidden' },
//   camera: { flex: 1 },
//   cameraOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
//   detectionText: { color: COLORS.success, fontSize: 10, position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', padding: 4 },
//   poseBox: { width: 200, height: 300, borderWidth: 2, borderColor: COLORS.glow, opacity: 0.5 },
//   camWarningBox: { backgroundColor: 'rgba(239, 68, 68, 0.8)', padding: 10, borderRadius: 5 },
//   camWarningText: { color: COLORS.white, fontWeight: 'bold' },
//   poseInfoBox: { position: 'absolute', bottom: 10, left: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 5 },
//   poseInfoText: { color: COLORS.success, fontWeight: 'bold', fontSize: 12 },
//   poseInfoSub: { color: COLORS.textDark, fontSize: 10 },
//   cameraOff: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.secondary },
//   cameraOffText: { color: COLORS.text, fontWeight: 'bold', marginTop: 10 },
//   cameraOffSub: { color: COLORS.textDark, fontSize: 10 },
//   exerciseList: { flex: 1, padding: 20 },
//   exerciseCard: { backgroundColor: COLORS.secondary, padding: 15, marginBottom: 10, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent },
//   exerciseCardActive: { borderColor: COLORS.blue, backgroundColor: '#1e293b' },
//   exerciseCardDone: { opacity: 0.6, borderColor: COLORS.success },
//   exHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
//   exIcon: { width: 40 },
//   exName: { color: COLORS.text, fontWeight: 'bold', marginBottom: 5 },
//   progressBarBg: { height: 4, backgroundColor: COLORS.accent, borderRadius: 2, width: '90%' },
//   progressBarFill: { height: '100%', backgroundColor: COLORS.blue, borderRadius: 2 },
//   countTextLarge: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' },
//   seriesControls: { flexDirection: 'row', alignItems: 'center', marginTop: 5, justifyContent: 'flex-end' },
//   seriesInput: { width: 50, height: 35, backgroundColor: COLORS.primary, color: COLORS.white, textAlign: 'center', borderRadius: 4, borderWidth: 1, borderColor: COLORS.accent, marginHorizontal: 5 },
//   seriesBtn: { backgroundColor: COLORS.blue, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 4, marginHorizontal: 5 },
//   seriesBtnSmall: { backgroundColor: COLORS.accent, width: 35, height: 35, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
//   seriesBtnText: { color: COLORS.white, fontSize: 10, fontWeight: 'bold' },
//   checkBtn: { width: 35, height: 35, borderRadius: 17.5, borderWidth: 1, borderColor: COLORS.textDark, alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
//   checkBtnDone: { backgroundColor: COLORS.success, borderColor: COLORS.success },
//   checkAllBtn: { marginVertical: 10, padding: 10, borderWidth: 1, borderColor: COLORS.blue, borderRadius: 8, alignItems: 'center' },
//   checkAllText: { color: COLORS.blue, fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
//   completeBtn: { backgroundColor: COLORS.blue, margin: 20, padding: 15, borderRadius: 8, alignItems: 'center' },
//   completeBtnText: { color: COLORS.primary, fontWeight: 'bold', letterSpacing: 2 },
//   programCard: { backgroundColor: COLORS.secondary, padding: 15, borderRadius: 8, marginBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
//   progTitle: { color: COLORS.text, fontSize: 16, fontWeight: 'bold' },
//   progSub: { color: COLORS.textDark, fontSize: 12 },
//   startBtnSmall: { backgroundColor: COLORS.success, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4, marginRight: 10 },
//   editProgBtn: { backgroundColor: COLORS.accent, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4, marginRight: 10 },
//   deleteProgBtn: { padding: 5 },
//   btnTextSmall: { color: COLORS.primary, fontWeight: 'bold', fontSize: 10 },
//   modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
//   createModal: { backgroundColor: COLORS.secondary, padding: 20, borderRadius: 12, borderWidth: 1, borderColor: COLORS.blue },
//   modalTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 15 },
//   selectRowContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: COLORS.accent },
//   rowLabel: { color: COLORS.textDark, fontSize: 16 },
//   repsInput: { backgroundColor: COLORS.primary, color: COLORS.white, width: 50, padding: 5, borderRadius: 4, textAlign: 'center', borderWidth: 1, borderColor: COLORS.blue, marginRight: 10 },
//   checkboxBtn: { padding: 5, borderRadius: 4, borderWidth: 1, borderColor: COLORS.blue },
//   checkboxActive: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
//   addCustomBtn: { backgroundColor: COLORS.blue, padding: 10, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
//   cancelBtn: { flex: 1, padding: 15, alignItems: 'center', marginRight: 10 },
//   saveBtn: { flex: 1, backgroundColor: COLORS.blue, padding: 15, alignItems: 'center', borderRadius: 6 },
//   btnText: { color: COLORS.text, fontWeight: 'bold' },
//   settingsSaveBtn: { backgroundColor: COLORS.blue, padding: 18, borderRadius: 8, alignItems: 'center', marginTop: 30 },
//   settingsSaveBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },
//   settingsAvatar: { width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: COLORS.blue, marginBottom: 10 },
//   editIconBadge: { position: 'absolute', bottom: 10, right: 10, backgroundColor: COLORS.blue, width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: COLORS.secondary },
//   statBoxLarge: { backgroundColor: COLORS.accent, padding: 20, alignItems: 'center', borderRadius: 12, marginTop: 20 },
//   bigStat: { color: COLORS.blue, fontSize: 40, fontWeight: 'bold' },
//   bigStatLbl: { color: COLORS.textDark, fontSize: 12, letterSpacing: 2 },
//   questPaperDark: { backgroundColor: COLORS.secondary, margin: 20, padding: 20, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent },
//   questTitleDark: { color: COLORS.text, fontSize: 20, fontWeight: 'bold', textAlign: 'center' },
//   difficulty: { color: COLORS.gold, textAlign: 'center', fontSize: 12, marginBottom: 10 },
//   objTitleDark: { color: COLORS.blue, fontWeight: 'bold', marginTop: 10 },
//   objRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
//   objTextDark: { color: COLORS.text },
//   objValDark: { color: COLORS.text, fontWeight: 'bold' },
//   divider: { height: 1, backgroundColor: COLORS.accent, marginVertical: 10 },
//   rewardTitleDark: { color: COLORS.text, fontWeight: 'bold' },
//   rewardText: { color: COLORS.blue, fontWeight: 'bold' },
//   acceptBtn: { backgroundColor: COLORS.blue, margin: 20, padding: 15, borderRadius: 8, alignItems: 'center' },
//   acceptBtnText: { color: COLORS.primary, fontWeight: 'bold', letterSpacing: 2 },
//   settingRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: COLORS.accent, alignItems: 'center' },
//   settingText: { color: COLORS.text, fontSize: 16 },
//   alertBox: { backgroundColor: COLORS.secondary, borderRadius: 12, borderWidth: 2, borderColor: COLORS.blue, padding: 20, width: '100%' },
//   alertTitle: { color: COLORS.blue, fontSize: 18, fontWeight: 'bold', textAlign: 'center', letterSpacing: 1 },
//   alertMessage: { color: COLORS.text, textAlign: 'center', marginVertical: 15 },
//   alertButtons: { flexDirection: 'row', justifyContent: 'center', marginTop: 10 },
//   alertButton: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 6, minWidth: 80, alignItems: 'center', marginHorizontal: 5 },
//   alertButtonDefault: { backgroundColor: COLORS.blue },
//   alertButtonDestructive: { backgroundColor: COLORS.danger },
//   alertButtonCancel: { backgroundColor: COLORS.accent },
//   alertButtonText: { color: COLORS.text, fontWeight: 'bold', fontSize: 12 },
//   timerCircle: { width: 120, height: 120, borderRadius: 60, borderWidth: 4, borderColor: COLORS.blue, justifyContent: 'center', alignItems: 'center', marginVertical: 30 },
//   timerText: { fontSize: 40, fontWeight: 'bold', color: COLORS.white },
//   dayBtn: { width: 35, height: 35, borderRadius: 17.5, backgroundColor: COLORS.secondary, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.accent },
//   dayBtnActive: { backgroundColor: COLORS.blue, borderColor: COLORS.glow },
//   dayBtnText: { color: COLORS.textDark, fontSize: 12, fontWeight: 'bold' },
// });





// import React, { useState, useEffect, useRef } from 'react';
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   ScrollView,
//   TextInput,
//   Animated,
//   Dimensions,
//   StatusBar,
//   Modal,
//   Image,
//   Vibration,
//   Platform,
// } from 'react-native';
// import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
// import AsyncStorage from '@react-native-async-storage/async-storage';
// import { CameraView, useCameraPermissions, CameraType } from 'expo-camera';
// import { LineChart } from 'react-native-chart-kit';
// import { createAudioPlayer } from 'expo-audio';
// import { Audio } from 'expo-av'; // Added for background audio session management
// import * as DocumentPicker from 'expo-document-picker';
// import * as ImagePicker from 'expo-image-picker';
// import Slider from '@react-native-community/slider';
// import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';

// const { width, height } = Dimensions.get('window');

// // --- Type Definitions ---
// type GoalType = 'muscle' | 'weight_loss' | 'speed_strength';

// interface UserData {
//   name: string;
//   level: number;
//   sex: 'male' | 'female';
//   weight: number;
//   height: number;
//   goal: GoalType; 
//   xp: number;
//   totalWorkouts: number;
//   createdAt: string;
//   lastDailyQuestCompleted?: string; // ISO Date only YYYY-MM-DD
//   cameraEnabled: boolean;
//   profileImage?: string;
//   assessmentStats?: { [key: string]: number };
// }

// interface Exercise {
//   name: string;
//   iconName: string;
//   iconLib: 'Ionicons' | 'MaterialCommunityIcons' | 'FontAwesome5';
//   type?: 'reps' | 'duration' | 'distance';
//   custom?: boolean;
// }

// interface ExerciseConfig {
//   [key: string]: Exercise;
// }

// interface Quest {
//   title: string;
//   difficulty: number;
//   exercises: { [key: string]: number };
//   rewards: {
//     xp: number;
//     title: string;
//   };
//   customExercises?: ExerciseConfig;
//   isDaily?: boolean; // To track if this is the daily requirement
// }

// interface TrainingResult {
//   [key: string]: number;
// }

// interface TrainingHistory {
//   date: string;
//   quest: Quest;
//   results: TrainingResult;
//   xpGained: number;
//   durationSeconds?: number;
// }

// interface MusicTrack {
//   id: string;
//   title: string;
//   path: any; // require() or uri string
//   isLocal: boolean;
//   isFavorite: boolean;
//   artwork?: string;
// }

// interface CustomProgram {
//   id: string;
//   name: string;
//   exercises: { [key: string]: number };
//   customExercises?: ExerciseConfig;
//   schedule: string[]; // ['Mon', 'Wed', etc.]
//   createdAt: string;
// }

// interface AlertButton {
//   text: string;
//   onPress?: () => void;
//   style?: 'default' | 'cancel' | 'destructive';
// }

// interface CustomAlertState {
//   visible: boolean;
//   title: string;
//   message: string;
//   buttons: AlertButton[];
// }

// type PlaybackMode = 'loop_all' | 'play_all' | 'loop_one' | 'play_one';

// // --- Theme ---
// const COLORS = {
//   primary: '#050714',     
//   secondary: '#0F172A',   
//   accent: '#1E293B',      
//   highlight: '#2563EB',   
//   blue: '#3B82F6',        
//   lightBlue: '#60A5FA',
//   purple: '#7C3AED',      
//   danger: '#EF4444',
//   success: '#10B981',
//   text: '#F8FAFC',
//   textDark: '#94A3B8',
//   glow: '#0EA5E9',
//   gold: '#F59E0B',
//   white: '#FFFFFF',
// };

// // --- Constants ---
// const XP_PER_LEVEL_BASE = 600; 
// const PENALTY_XP = 100;
// const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// const EXERCISES: ExerciseConfig = {
//   // Standard
//   squats: { name: 'Squats', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   pushups: { name: 'Push-ups', iconName: 'human-handsup', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   situps: { name: 'Sit-ups', iconName: 'dumbbell', iconLib: 'FontAwesome5', type: 'reps' },
//   pullups: { name: 'Pull-ups', iconName: 'human-male-height', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   bicepCurls: { name: 'Bicep Curls', iconName: 'arm-flex', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   lunges: { name: 'Lunges', iconName: 'run', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   plank: { name: 'Plank (sec)', iconName: 'timer', iconLib: 'Ionicons', type: 'duration' },
//   running: { name: 'Running (km)', iconName: 'run-fast', iconLib: 'MaterialCommunityIcons', type: 'distance' },
  
//   // Dynamic / Speed & Strength
//   clapPushups: { name: 'Clap Push-ups', iconName: 'flash', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   jumpSquats: { name: 'Jump Squats', iconName: 'arrow-up-bold-circle', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   burpees: { name: 'Burpees', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
// };

// // --- Pose Detection Logic (Translated from Python) ---
// class PoseCalculator {
//   static calculateAngle(a: {x:number, y:number}, b: {x:number, y:number}, c: {x:number, y:number}) {
//     const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
//     let angle = Math.abs(radians * 180.0 / Math.PI);
//     if (angle > 180.0) angle = 360 - angle;
//     return angle;
//   }

//   // Returns true if squat down state, false if up, null if neither (intermediate)
//   static detectSquat(landmarks: any): { angle: number } {
//     return { angle: 0 }; 
//   }

//   static isSupported(exerciseKey: string): boolean {
//       const supported = ['squats', 'pushups', 'situps', 'bicepCurls', 'lifting'];
//       return supported.includes(exerciseKey);
//   }
// }

// // --- Sound System ---
// const SYSTEM_SOUND = require('../assets/audio/solo_leveling_system.mp3'); 
// const DEFAULT_OST = require('../assets/audio/ost.mp3');

// // --- Helper Functions ---
// const getDayString = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'short' });
// const getISODate = (date: Date) => date.toISOString().split('T')[0];

// // --- Helper Components ---
// const SoloIcon = ({ name, lib, size = 24, color = COLORS.text }: { name: string, lib: string, size?: number, color?: string }) => {
//   if (lib === 'Ionicons') return <Ionicons name={name as any} size={size} color={color} />;
//   if (lib === 'MaterialCommunityIcons') return <MaterialCommunityIcons name={name as any} size={size} color={color} />;
//   if (lib === 'FontAwesome5') return <FontAwesome5 name={name as any} size={size} color={color} />;
//   return null;
// };

// const CustomAlert = ({ visible, title, message, buttons, onClose }: { visible: boolean, title: string, message: string, buttons: AlertButton[], onClose: () => void }) => {
//   if (!visible) return null;
//   return (
//     <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
//       <View style={styles.modalOverlay}>
//         <View style={styles.alertBox}>
//           <Text style={styles.alertTitle}>{title}</Text>
//           <View style={styles.divider} />
//           <Text style={styles.alertMessage}>{message}</Text>
//           <View style={styles.alertButtons}>
//             {buttons.map((btn, index) => (
//               <TouchableOpacity
//                 key={index}
//                 style={[
//                   styles.alertButton,
//                   btn.style === 'destructive' ? styles.alertButtonDestructive : 
//                   btn.style === 'cancel' ? styles.alertButtonCancel : styles.alertButtonDefault
//                 ]}
//                 onPress={() => {
//                   if (btn.onPress) btn.onPress();
//                   onClose();
//                 }}
//               >
//                 <Text style={styles.alertButtonText}>{btn.text}</Text>
//               </TouchableOpacity>
//             ))}
//           </View>
//         </View>
//       </View>
//     </Modal>
//   );
// };

// // --- Main App ---
// export default function SoloLevelingFitnessTracker(): JSX.Element {
//   // Global State
//   const [screen, setScreenState] = useState<string>('loading');
//   const [userData, setUserData] = useState<UserData | null>(null);
//   const [customPrograms, setCustomPrograms] = useState<CustomProgram[]>([]);
  
//   // Alert State
//   const [alertState, setAlertState] = useState<CustomAlertState>({
//     visible: false, title: '', message: '', buttons: [],
//   });

//   // Music Player State
//   const [playlist, setPlaylist] = useState<MusicTrack[]>([]);
//   const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
//   const [player, setPlayer] = useState<any | null>(null); // Type: AudioPlayer from expo-audio
//   const [isPlaying, setIsPlaying] = useState(false);
//   const [musicLoading, setMusicLoading] = useState(false); 
//   const [position, setPosition] = useState(0);
//   const [duration, setDuration] = useState(0);
//   const [isMuted, setIsMuted] = useState(false);
//   const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('loop_all');
  
//   // Refs for logic to avoid stale closures
//   const playlistRef = useRef<MusicTrack[]>([]);
//   const currentTrackRef = useRef<MusicTrack | null>(null);
//   const playbackModeRef = useRef<PlaybackMode>('loop_all');
//   const playerRef = useRef<any | null>(null);

//   useEffect(() => { playlistRef.current = playlist; }, [playlist]);
//   useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
//   useEffect(() => { playbackModeRef.current = playbackMode; }, [playbackMode]);

//   // System Sound State
//   const [systemPlayer, setSystemPlayer] = useState<any | null>(null);

//   // Training State
//   const [currentQuest, setCurrentQuest] = useState<Quest | null>(null);
//   const [isTraining, setIsTraining] = useState<boolean>(false);

//   // --- Audio System Logic ---

//   const playSystemSound = async () => {
//     try {
//       if (systemPlayer) systemPlayer.release();
      
//       const activeMusic = playerRef.current;
//       // Ducking music volume
//       if (activeMusic && isPlaying) activeMusic.volume = 0.1; 

//       const newSysPlayer = createAudioPlayer(SYSTEM_SOUND);
//       setSystemPlayer(newSysPlayer);
//       newSysPlayer.play();

//       newSysPlayer.addListener('playbackStatusUpdate', (status: any) => {
//         if (status.didJustFinish) {
//             newSysPlayer.release();
//             setSystemPlayer(null);
//             // Restore music volume
//             if (activeMusic && isPlaying) activeMusic.volume = 1.0;
//         }
//       });
//     } catch (error) { console.log('System sound error', error); }
//   };

//   const navigateTo = (newScreen: string) => {
//     if (newScreen !== screen) {
//       playSystemSound();
//       setScreenState(newScreen);
//     }
//   };

//   const showAlert = (title: string, message: string, buttons: AlertButton[] = [{ text: 'OK' }]) => {
//     setAlertState({ visible: true, title, message, buttons });
//   };

//   const closeAlert = () => {
//     setAlertState(prev => ({ ...prev, visible: false }));
//   };

//   // --- Initialization & Penalty System ---
//   useEffect(() => {
//     async function init() {
//       // 1. Configure Background Audio
//       try {
//         await Audio.setAudioModeAsync({
//           staysActiveInBackground: true,
//           playsInSilentModeIOS: true,
//           shouldDuckAndroid: true,
//           playThroughEarpieceAndroid: false,
//         });
//       } catch (e) {
//         console.warn("Audio Mode Config Error:", e);
//       }

//       // Load Music
//       try {
//         const stored = await AsyncStorage.getItem('musicPlaylist');
//         const defaultTrack: MusicTrack = { id: 'default_ost', title: 'System Soundtrack (Default)', path: DEFAULT_OST, isLocal: true, isFavorite: true };
//         let tracks: MusicTrack[] = [defaultTrack];
//         if (stored) {
//           const parsed = JSON.parse(stored);
//           const userTracks = parsed.filter((t: MusicTrack) => t.id !== 'default_ost');
//           tracks = [...tracks, ...userTracks];
//         }
//         setPlaylist(tracks);
//       } catch (e) { console.error("Audio Init Error", e); }

//       playSystemSound();
      
//       // Load Data
//       const progData = await AsyncStorage.getItem('customPrograms');
//       const loadedPrograms: CustomProgram[] = progData ? JSON.parse(progData) : [];
//       setCustomPrograms(loadedPrograms);

//       const data = await AsyncStorage.getItem('userData');
//       if (data) {
//         let user: UserData = JSON.parse(data);
//         user = await checkPenalties(user, loadedPrograms); // Check for missed quests
//         setUserData(user);
//         setScreenState('dashboard');
//       } else {
//         setScreenState('setup');
//       }
//     }
//     init();

//     return () => {
//       if (playerRef.current) playerRef.current.release();
//       if (systemPlayer) systemPlayer.release();
//     };
//   }, []);

//   const checkPenalties = async (user: UserData, programs: CustomProgram[]): Promise<UserData> => {
//     if (!user.lastDailyQuestCompleted) {
//         const yesterday = new Date();
//         yesterday.setDate(yesterday.getDate() - 1);
//         user.lastDailyQuestCompleted = getISODate(yesterday);
//         await AsyncStorage.setItem('userData', JSON.stringify(user));
//         return user;
//     }

//     const lastDate = new Date(user.lastDailyQuestCompleted);
//     const today = new Date();
//     const todayStr = getISODate(today);
    
//     if (user.lastDailyQuestCompleted === todayStr) return user;

//     let penaltyXP = 0;
//     let missedDays = 0;
    
//     const checkDate = new Date(lastDate);
//     checkDate.setDate(checkDate.getDate() + 1);

//     while (getISODate(checkDate) < todayStr) {
//         penaltyXP += PENALTY_XP;
//         missedDays++;
//         checkDate.setDate(checkDate.getDate() + 1);
//     }

//     if (penaltyXP > 0) {
//         let newXP = user.xp - penaltyXP;
//         let newLevel = user.level;

//         while (newXP < 0) {
//             if (newLevel > 1) {
//                 newLevel--;
//                 const xpForPrevLevel = newLevel * XP_PER_LEVEL_BASE;
//                 newXP = xpForPrevLevel + newXP;
//             } else {
//                 newXP = 0;
//                 break;
//             }
//         }

//         user.xp = newXP;
//         user.level = newLevel;

//         showAlert(
//           "PENALTY SYSTEM", 
//           `You failed to complete daily quests for ${missedDays} day(s).\n\nPUNISHMENT: -${penaltyXP} XP.\n${user.level < (JSON.parse(await AsyncStorage.getItem('userData') || '{}').level || user.level) ? 'YOUR LEVEL HAS DECREASED.' : ''}`
//         );
        
//         await AsyncStorage.setItem('userData', JSON.stringify(user));
//     }

//     return user;
//   };

//   // UI Updater
//   useEffect(() => {
//     let interval: NodeJS.Timeout;
//     if (player && isPlaying) {
//       interval = setInterval(() => {
//         try {
//             if(playerRef.current) {
//                 setPosition(playerRef.current.currentTime);
//                 setDuration(playerRef.current.duration || 1);
//             }
//         } catch (e) {}
//       }, 1000);
//     }
//     return () => clearInterval(interval);
//   }, [player, isPlaying]);

//   const handleAutoNext = async (finishedPlayer: any) => {
//     const list = playlistRef.current;
//     const curr = currentTrackRef.current;
//     const mode = playbackModeRef.current;
//     const activePlayer = playerRef.current;

//     // Safety check: ensure we are responding to the event from the currently active player
//     if (!curr || list.length === 0 || finishedPlayer !== activePlayer) return;

//     if (mode === 'loop_one') {
//       // Should be handled by native loop property, but if explicit logic needed:
//       activePlayer.seekTo(0);
//       activePlayer.play();
//     } 
//     else if (mode === 'play_one') {
//       setIsPlaying(false); setPosition(0);
//       activePlayer.pause();
//       activePlayer.seekTo(0);
//     } 
//     else if (mode === 'play_all') {
//       const idx = list.findIndex(t => t.id === curr.id);
//       if (idx !== -1 && idx < list.length - 1) {
//         playTrack(list[idx + 1]);
//       } else {
//         setIsPlaying(false); setPosition(0);
//         activePlayer.pause();
//         activePlayer.seekTo(0);
//       }
//     } 
//     else if (mode === 'loop_all') {
//       const idx = list.findIndex(t => t.id === curr.id);
//       const nextIdx = (idx + 1) % list.length;
//       const nextTrack = list[nextIdx];

//       // If wrapping around to the SAME track (e.g. 1 item in playlist), seek and play instead of reloading
//       if (nextTrack.id === curr.id) {
//           activePlayer.seekTo(0);
//           activePlayer.play();
//           return;
//       }

//       playTrack(nextTrack);
//     }
//   };

//   const saveUserData = async (data: UserData) => {
//     await AsyncStorage.setItem('userData', JSON.stringify(data));
//     setUserData(data);
//   };

//   const updateCustomPrograms = async (programs: CustomProgram[]) => {
//       setCustomPrograms(programs);
//       await AsyncStorage.setItem('customPrograms', JSON.stringify(programs));
//   };

//   // --- Music Controls ---
//   const playTrack = async (track: MusicTrack) => {
//     if (musicLoading) return;
    
//     const activePlayer = playerRef.current;
//     const activeTrack = currentTrackRef.current;

//     // Prevent re-creating player if user taps the playing song
//     if (activeTrack?.id === track.id && activePlayer) {
//         if(!activePlayer.playing) {
//              activePlayer.play();
//              setIsPlaying(true);
//         }
//         return;
//     }

//     try {
//       setMusicLoading(true);
      
//       // Release old player safely
//       if (activePlayer) { 
//           activePlayer.release(); 
//           playerRef.current = null;
//           setPlayer(null);
//       }

//       const source = track.isLocal ? track.path : { uri: track.path };
      
//       const newPlayer = createAudioPlayer(source);
//       const mode = playbackModeRef.current;
//       newPlayer.loop = (mode === 'loop_one'); // Native loop for loop_one

//       newPlayer.addListener('playbackStatusUpdate', (status: any) => {
//          // Only trigger auto-next if didJustFinish is true AND we aren't using native looping
//          if (status.didJustFinish && !newPlayer.loop) handleAutoNext(newPlayer);
//       });

//       if (isMuted) newPlayer.muted = true;

//       playerRef.current = newPlayer; // Update Ref
//       setPlayer(newPlayer); // Update State for UI re-render
//       setCurrentTrack(track); // Update Track
      
//       newPlayer.play();
//       setIsPlaying(true);
      
//       setMusicLoading(false);
//     } catch (error) {
//       console.log('Play Error', error);
//       setMusicLoading(false);
//       showAlert('Error', 'Could not play audio track.');
//     }
//   };

//   const togglePlayPause = async () => {
//     const activePlayer = playerRef.current;

//     if (!activePlayer) { 
//         if (playlist.length > 0) playTrack(playlist[0]); 
//         return; 
//     }
//     if (musicLoading) return;
    
//     if (isPlaying) { 
//         activePlayer.pause(); 
//         setIsPlaying(false); 
//     } else { 
//         activePlayer.play(); 
//         setIsPlaying(true); 
//     }
//   };

//   const seekTrack = async (value: number) => {
//     const activePlayer = playerRef.current;
//     if (activePlayer && !musicLoading) { 
//         activePlayer.seekTo(value);
//         setPosition(value); 
//     }
//   };

//   const skipToNext = () => {
//     if (!currentTrack || playlist.length === 0) return;
//     const idx = playlist.findIndex(t => t.id === currentTrack.id);
//     const nextIdx = (idx + 1) % playlist.length;
//     playTrack(playlist[nextIdx]);
//   };

//   const skipToPrev = () => {
//     if (!currentTrack || playlist.length === 0) return;
//     const idx = playlist.findIndex(t => t.id === currentTrack.id);
//     const prevIdx = idx === 0 ? playlist.length - 1 : idx - 1;
//     playTrack(playlist[prevIdx]);
//   };

//   const deleteTrack = async (trackId: string) => {
//     if (trackId === 'default_ost') return;
//     if (currentTrack?.id === trackId) { 
//         if (playerRef.current) playerRef.current.release();
//         playerRef.current = null;
//         setPlayer(null);
//         setCurrentTrack(null);
//         setIsPlaying(false); 
//     }
//     const newList = playlist.filter(t => t.id !== trackId);
//     setPlaylist(newList);
//     AsyncStorage.setItem('musicPlaylist', JSON.stringify(newList));
//   };

//   const addMusicFile = async () => {
//     try {
//       const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
//       if (!result.canceled && result.assets && result.assets.length > 0) {
//         const file = result.assets[0];
//         const newTrack: MusicTrack = { id: Date.now().toString(), title: file.name, path: file.uri, isLocal: false, isFavorite: false };
//         const newList = [...playlist, newTrack];
//         setPlaylist(newList);
//         AsyncStorage.setItem('musicPlaylist', JSON.stringify(newList));
//       }
//     } catch (e) { showAlert('Error', 'Failed to pick audio file'); }
//   };

//   // --- Mini Player ---
//   const MiniPlayer = () => {
//     if (!currentTrack) return null;
//     return (
//       <TouchableOpacity activeOpacity={0.9} onPress={() => navigateTo('music')} style={styles.miniPlayerContainer}>
//          <View style={styles.miniProgressContainer}><View style={[styles.miniProgressFill, { width: `${(position / (duration || 1)) * 100}%` }]} /></View>
//          <View style={styles.miniPlayerContent}>
//             <View style={styles.miniInfo}>
//                {currentTrack.artwork ? ( <Image source={{ uri: currentTrack.artwork }} style={styles.miniArt} /> ) : ( <Ionicons name="musical-note" size={20} color={COLORS.blue} style={{marginRight: 10}} /> )}
//                <View><Text style={styles.miniTitle} numberOfLines={1}>{currentTrack.title}</Text><Text style={styles.miniTime}>{formatTime(position)} / {formatTime(duration)}</Text></View>
//             </View>
//             <View style={styles.miniControls}>
//                <TouchableOpacity onPress={(e) => { e.stopPropagation(); skipToPrev(); }} style={styles.miniCtrlBtn}><Ionicons name="play-skip-back" size={20} color={COLORS.text} /></TouchableOpacity>
//                <TouchableOpacity onPress={(e) => { e.stopPropagation(); togglePlayPause(); }} style={styles.miniCtrlBtn}><Ionicons name={isPlaying ? "pause" : "play"} size={26} color={COLORS.white} /></TouchableOpacity>
//                <TouchableOpacity onPress={(e) => { e.stopPropagation(); skipToNext(); }} style={styles.miniCtrlBtn}><Ionicons name="play-skip-forward" size={20} color={COLORS.text} /></TouchableOpacity>
//             </View>
//          </View>
//       </TouchableOpacity>
//     );
//   };

//   // --- Render Current Screen ---
//   const renderScreen = () => {
//     if (!userData && screen !== 'loading' && screen !== 'setup') return <LoadingScreen />;

//     switch (screen) {
//       case 'loading': return <LoadingScreen />;
//       case 'setup': 
//         return <SetupScreen onComplete={(data) => { setUserData(data); setScreenState('assessment'); }} />;
//       case 'assessment':
//         return <AssessmentScreen userData={userData!} onComplete={(stats, calculatedLevel) => {
//             const finalData = { ...userData!, level: calculatedLevel, assessmentStats: stats, createdAt: new Date().toISOString(), lastDailyQuestCompleted: getISODate(new Date()) };
//             saveUserData(finalData);
//             navigateTo('dashboard');
//         }} />;
//       case 'dashboard': 
//         return <DashboardScreen userData={userData!} onNavigate={navigateTo} onStartQuest={() => navigateTo('quest')} />;
//       case 'quest': 
//         return <QuestScreen 
//           userData={userData!} 
//           customPrograms={customPrograms}
//           onBack={() => navigateTo('dashboard')}
//           onStartTraining={(quest) => { setCurrentQuest(quest); setIsTraining(true); navigateTo('training'); }}
//         />;
//       case 'training':
//         return <TrainingScreen 
//           userData={userData!} 
//           quest={currentQuest!} 
//           showAlert={showAlert} // Passing alert handler
//           onComplete={(results, duration) => { updateProgress(results, duration); navigateTo('dashboard'); }}
//           onBack={() => { 
//             showAlert("Abort Mission?", "Stop training?", [
//               { text: "Cancel", style: "cancel" }, 
//               { text: "Quit", style: "destructive", onPress: () => navigateTo('dashboard') }
//             ]); 
//           }}
//         />;
//       case 'stats': return <StatsScreen userData={userData!} onBack={() => navigateTo('dashboard')} />;
//       case 'music': return <MusicScreen 
//           playlist={playlist} currentTrack={currentTrack} isPlaying={isPlaying} isLoading={musicLoading}
//           position={position} duration={duration} playbackMode={playbackMode}
//           onPlay={playTrack} onPause={togglePlayPause} onSeek={seekTrack} onNext={skipToNext} onPrev={skipToPrev} onDelete={deleteTrack} onAdd={addMusicFile}
//           onToggleMode={() => {
//             const modes: PlaybackMode[] = ['loop_all', 'play_all', 'loop_one', 'play_one'];
//             const nextMode = modes[(modes.indexOf(playbackMode) + 1) % modes.length];
//             setPlaybackMode(nextMode);
//             // Sync current player native loop property
//             if(playerRef.current) {
//                 playerRef.current.loop = (nextMode === 'loop_one');
//             }
//           }}
//           onBack={() => navigateTo('dashboard')} 
//         />;
//       case 'programs': return <CustomProgramsScreen 
//           userData={userData!} 
//           customPrograms={customPrograms}
//           setCustomPrograms={updateCustomPrograms}
//           onBack={() => navigateTo('dashboard')} 
//           onStartProgram={(quest) => { setCurrentQuest(quest); setIsTraining(true); navigateTo('training'); }}
//           showAlert={showAlert}
//         />;
//       case 'settings': return <SettingsScreen userData={userData!} onSave={(data) => { saveUserData(data); navigateTo('dashboard'); }} onBack={() => navigateTo('dashboard')} />;
//       default: return <LoadingScreen />;
//     }
//   };

//   const updateProgress = async (results: TrainingResult, duration: number) => {
//     try {
//       let xpGained = 0;
//       if (currentQuest?.isDaily) {
//           xpGained = currentQuest.rewards.xp;
//           const todayStr = getISODate(new Date());
//           userData!.lastDailyQuestCompleted = todayStr;
//       } else {
//           xpGained = 100;
//       }

//       const history = await AsyncStorage.getItem('trainingHistory');
//       const parsed: TrainingHistory[] = history ? JSON.parse(history) : [];
//       const newEntry: TrainingHistory = { date: new Date().toISOString(), quest: currentQuest!, results: results, xpGained: xpGained, durationSeconds: duration };
//       parsed.push(newEntry);
//       await AsyncStorage.setItem('trainingHistory', JSON.stringify(parsed));

//       const xpNeeded = userData!.level * XP_PER_LEVEL_BASE;
//       let newTotalXP = userData!.xp + xpGained;
//       let newLevel = userData!.level;
//       let leveledUp = false;

//       while (newTotalXP >= xpNeeded) {
//         newTotalXP -= xpNeeded;
//         newLevel++;
//         leveledUp = true;
//       }

//       const newUserData: UserData = {
//         ...userData!, xp: newTotalXP, level: newLevel, totalWorkouts: (userData!.totalWorkouts || 0) + 1,
//       };
      
//       if (leveledUp) {
//         showAlert('LEVEL UP!', `You have reached Level ${newLevel}!`);
//       } else {
//         showAlert('QUEST COMPLETED', `You gained ${xpGained} Experience Points.`);
//       }
//       saveUserData(newUserData);
//     } catch (error) { console.error('Error updating progress:', error); }
//   };

//   return (
//     <SafeAreaProvider>
//         <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
//         <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} translucent={false} />
//         <View style={{ flex: 1, paddingBottom: (currentTrack && screen !== 'music') ? 70 : 0 }}>{renderScreen()}</View>
//         {currentTrack && screen !== 'music' && <MiniPlayer />}
//         <CustomAlert visible={alertState.visible} title={alertState.title} message={alertState.message} buttons={alertState.buttons} onClose={closeAlert} />
//         </SafeAreaView>
//     </SafeAreaProvider>
//   );
// }

// // --- Screens ---

// function LoadingScreen() {
//   const spinValue = useRef(new Animated.Value(0)).current;
//   useEffect(() => { Animated.loop(Animated.timing(spinValue, { toValue: 1, duration: 2000, useNativeDriver: true })).start(); }, []);
//   const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
//   return (
//     <View style={styles.centerContainer}>
//       <Animated.View style={{ transform: [{ rotate: spin }], marginBottom: 20 }}><Ionicons name="reload-circle-outline" size={60} color={COLORS.blue} /></Animated.View>
//       <Text style={styles.loadingTitle}>SOLO LEVELING</Text><Text style={styles.loadingSubtitle}>INITIALIZING SYSTEM...</Text>
//     </View>
//   );
// }

// function SetupScreen({ onComplete }: { onComplete: (data: UserData) => void }) {
//   const [formData, setFormData] = useState<any>({ name: '', level: 1, sex: 'male', weight: '', height: '', goal: 'muscle' });
//   const [image, setImage] = useState<string | null>(null);
//   const pickImage = async () => {
//     let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5 });
//     if (!result.canceled) setImage(result.assets[0].uri);
//   };
//   const handleNext = () => {
//     if (!formData.name) return;
//     onComplete({ ...formData, weight: parseFloat(formData.weight) || 70, height: parseFloat(formData.height) || 170, xp: 0, totalWorkouts: 0, createdAt: new Date().toISOString(), cameraEnabled: false, profileImage: image || undefined });
//   };
//   const GoalButton = ({ type, icon, label }: { type: GoalType, icon: string, label: string }) => (
//     <TouchableOpacity style={[styles.goalBtn, formData.goal === type && styles.goalBtnActive]} onPress={() => setFormData({...formData, goal: type})}>
//         <MaterialCommunityIcons name={icon as any} size={24} color={formData.goal === type ? COLORS.white : COLORS.blue} />
//         <Text style={formData.goal === type ? styles.goalTextActive : styles.goalText}>{label}</Text>
//     </TouchableOpacity>
//   );
//   return (
//     <ScrollView style={styles.screenContainer} contentContainerStyle={{padding: 20}}>
//       <Text style={styles.headerTitle}>PLAYER REGISTRATION</Text>
//       <TouchableOpacity onPress={pickImage} style={styles.avatarPicker}>
//         {image ? ( <Image source={{ uri: image }} style={styles.avatarImage} /> ) : ( <View style={styles.avatarPlaceholder}><Ionicons name="camera" size={40} color={COLORS.textDark} /><Text style={styles.avatarText}>ADD PHOTO</Text></View> )}
//       </TouchableOpacity>
//       <View style={styles.formGroup}><Text style={styles.label}>HUNTER NAME</Text><TextInput style={styles.input} placeholder="Enter Name" placeholderTextColor={COLORS.textDark} onChangeText={t => setFormData({...formData, name: t})} /></View>
//       <View style={styles.formGroup}><Text style={styles.label}>GOAL / CLASS</Text><GoalButton type="muscle" icon="arm-flex" label="Muscle & Strength" /><GoalButton type="weight_loss" icon="run-fast" label="Weight Loss" /><GoalButton type="speed_strength" icon="flash" label="Speed & Strength (Assassin)" /></View>
//       <View style={styles.formGroup}><Text style={styles.label}>GENDER</Text><View style={styles.genderContainer}><TouchableOpacity style={[styles.genderBtn, formData.sex === 'male' && styles.genderBtnActive]} onPress={() => setFormData({...formData, sex: 'male'})}><Ionicons name="male" size={20} color={formData.sex === 'male' ? COLORS.white : COLORS.blue} /><Text style={formData.sex === 'male' ? styles.genderTextActive : styles.genderText}>MALE</Text></TouchableOpacity><TouchableOpacity style={[styles.genderBtn, formData.sex === 'female' && styles.genderBtnActive]} onPress={() => setFormData({...formData, sex: 'female'})}><Ionicons name="female" size={20} color={formData.sex === 'female' ? COLORS.white : COLORS.blue} /><Text style={formData.sex === 'female' ? styles.genderTextActive : styles.genderText}>FEMALE</Text></TouchableOpacity></View></View>
//       <View style={styles.row}><View style={[styles.formGroup, {flex:1, marginRight: 10}]}><Text style={styles.label}>WEIGHT (KG)</Text><TextInput style={styles.input} keyboardType="numeric" onChangeText={t => setFormData({...formData, weight: t})} /></View><View style={[styles.formGroup, {flex:1}]}><Text style={styles.label}>HEIGHT (CM)</Text><TextInput style={styles.input} keyboardType="numeric" onChangeText={t => setFormData({...formData, height: t})} /></View></View>
//       <TouchableOpacity style={styles.mainButton} onPress={handleNext}><Text style={styles.mainButtonText}>PROCEED TO EVALUATION</Text></TouchableOpacity>
//     </ScrollView>
//   );
// }

// function AssessmentScreen({ userData, onComplete }: { userData: UserData, onComplete: (stats: any, level: number) => void }) {
//     const [step, setStep] = useState<'intro' | 'active' | 'rest' | 'input'>('intro');
//     const [currentExIndex, setCurrentExIndex] = useState(0);
//     const [timer, setTimer] = useState(0);
//     const [reps, setReps] = useState('');
//     const [results, setResults] = useState<{[key:string]: number}>({});

//     const getExercises = () => {
//         if (userData.goal === 'speed_strength') return ['pushups', 'jumpSquats', 'lunges']; 
//         else if (userData.goal === 'weight_loss') return ['squats', 'situps', 'lunges']; 
//         else return ['pushups', 'squats', 'situps']; 
//     };

//     const exercises = getExercises();
//     const currentEx = exercises[currentExIndex];
//     const EX_TIME = 60; const REST_TIME = 15;

//     useEffect(() => {
//         let interval: NodeJS.Timeout;
//         if ((step === 'active' || step === 'rest') && timer > 0) {
//             interval = setInterval(() => {
//                 setTimer(prev => {
//                     if (prev <= 1) {
//                         if (step === 'active') { Vibration.vibrate(); setStep('input'); } 
//                         else if (step === 'rest') {
//                             if (currentExIndex < exercises.length - 1) { setCurrentExIndex(prevIdx => prevIdx + 1); startExercise(); } 
//                             else { finishAssessment(); }
//                         }
//                         return 0;
//                     }
//                     return prev - 1;
//                 });
//             }, 1000);
//         }
//         return () => clearInterval(interval);
//     }, [step, timer]);

//     const startExercise = () => { setTimer(EX_TIME); setStep('active'); setReps(''); };
//     const handleInput = () => {
//         const count = parseInt(reps) || 0;
//         setResults(prev => ({...prev, [currentEx]: count}));
//         if (currentExIndex < exercises.length - 1) { setTimer(REST_TIME); setStep('rest'); } 
//         else { finishAssessment(count); }
//     };

//     const finishAssessment = (lastReps?: number) => {
//         const finalResults = lastReps ? {...results, [currentEx]: lastReps} : results;
//         let totalReps = 0; Object.values(finalResults).forEach(val => totalReps += val);
//         const calculatedLevel = Math.max(1, Math.floor(totalReps / 40) + 1);
//         onComplete(finalResults, calculatedLevel);
//     };

//     return (
//         <View style={styles.centerContainer}>
//             <Text style={styles.headerTitle}>SYSTEM EVALUATION</Text>
//             {step === 'intro' && (
//                 <View style={{padding: 20, alignItems: 'center'}}>
//                     <Text style={styles.questTitleDark}>RANKING TEST</Text>
//                     <Text style={styles.alertMessage}>You will perform 3 exercises to determine your Hunter Rank. {"\n\n"}1 Minute MAX reps for each.{"\n"}15 Seconds rest between sets.</Text>
//                     {exercises.map(e => ( <View key={e} style={{flexDirection:'row', marginVertical: 5}}><SoloIcon name={EXERCISES[e].iconName} lib={EXERCISES[e].iconLib} color={COLORS.blue} /><Text style={{color: COLORS.text, marginLeft: 10}}>{EXERCISES[e].name}</Text></View> ))}
//                     <TouchableOpacity style={styles.mainButton} onPress={startExercise}><Text style={styles.mainButtonText}>START TEST</Text></TouchableOpacity>
//                 </View>
//             )}
//             {step === 'active' && (
//                 <View style={{alignItems: 'center'}}>
//                     <Text style={styles.loadingSubtitle}>CURRENT EXERCISE</Text><Text style={styles.loadingTitle}>{EXERCISES[currentEx].name}</Text>
//                     <View style={styles.timerCircle}><Text style={styles.timerText}>{timer}</Text></View><Text style={styles.label}>DO AS MANY AS YOU CAN</Text>
//                 </View>
//             )}
//             {step === 'input' && (
//                 <View style={{alignItems: 'center', width: '80%'}}>
//                     <Text style={styles.questTitleDark}>TIME'S UP</Text><Text style={styles.label}>ENTER REPS COMPLETED:</Text>
//                     <TextInput style={[styles.input, {textAlign: 'center', fontSize: 24, width: 100}]} keyboardType="numeric" value={reps} onChangeText={setReps} autoFocus />
//                     <TouchableOpacity style={styles.mainButton} onPress={handleInput}><Text style={styles.mainButtonText}>CONFIRM</Text></TouchableOpacity>
//                 </View>
//             )}
//             {step === 'rest' && (
//                 <View style={{alignItems: 'center'}}>
//                     <Text style={styles.loadingTitle}>REST</Text><Text style={styles.timerText}>{timer}</Text><Text style={styles.loadingSubtitle}>NEXT: {EXERCISES[exercises[currentExIndex + 1]]?.name}</Text>
//                 </View>
//             )}
//         </View>
//     );
// }

// function DashboardScreen({ userData, onNavigate, onStartQuest }: any) {
//   if (!userData) return null;
//   const xpPercent = (userData.xp / (userData.level * XP_PER_LEVEL_BASE)) * 100;
//   return (
//     <ScrollView style={styles.screenContainer}>
//       <View style={styles.dashboardHeader}>
//         <View style={styles.profileRow}>
//           <Image source={userData.profileImage ? { uri: userData.profileImage } : { uri: 'https://via.placeholder.com/150' }} style={styles.profileImageSmall} />
//           <View><Text style={styles.playerName}>{userData.name}</Text><Text style={styles.playerRank}>LEVEL {userData.level}</Text><Text style={{color: COLORS.gold, fontSize: 10, letterSpacing: 1}}>CLASS: {userData.goal.replace('_', ' ').toUpperCase()}</Text></View>
//         </View>
//       </View>
//       <View style={styles.systemWindow}>
//         <Text style={styles.systemHeader}>STATUS</Text>
//         <View style={styles.xpBarContainer}><View style={[styles.xpBarFill, { width: `${xpPercent}%` }]} /></View>
//         <Text style={styles.xpText}>{userData.xp} / {userData.level * XP_PER_LEVEL_BASE} XP</Text>
//         <View style={styles.statGrid}>
//           <View style={styles.statItem}><Ionicons name="barbell-outline" size={20} color={COLORS.blue} /><Text style={styles.statVal}>{userData.totalWorkouts}</Text><Text style={styles.statLbl}>Raids</Text></View>
//           <View style={styles.statItem}><MaterialCommunityIcons name="fire" size={20} color={COLORS.danger} /><Text style={styles.statVal}>{userData.level}</Text><Text style={styles.statLbl}>Rank</Text></View>
//         </View>
//       </View>
//       <View style={styles.menuGrid}>
//         <TouchableOpacity style={styles.menuCardLarge} onPress={onStartQuest}>
//            <MaterialCommunityIcons name="sword-cross" size={40} color={COLORS.gold} /><Text style={styles.menuTitle}>DAILY QUEST</Text><Text style={styles.menuSub}>{userData.lastDailyQuestCompleted === getISODate(new Date()) ? 'Completed' : 'Available'}</Text>
//         </TouchableOpacity>
//         <View style={styles.menuRow}>
//            <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('programs')}><Ionicons name="list" size={24} color={COLORS.blue} /><Text style={styles.menuTitleSmall}>Programs</Text></TouchableOpacity>
//            <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('stats')}><Ionicons name="stats-chart" size={24} color={COLORS.success} /><Text style={styles.menuTitleSmall}>Stats</Text></TouchableOpacity>
//         </View>
//         <View style={styles.menuRow}>
//            <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('music')}><Ionicons name="musical-notes" size={24} color={COLORS.purple} /><Text style={styles.menuTitleSmall}>Music</Text></TouchableOpacity>
//            <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('settings')}><Ionicons name="settings" size={24} color={COLORS.textDark} /><Text style={styles.menuTitleSmall}>Settings</Text></TouchableOpacity>
//         </View>
//       </View>
//     </ScrollView>
//   );
// }

// function MusicScreen({ playlist, currentTrack, isPlaying, isLoading, position, duration, playbackMode, onPlay, onPause, onSeek, onNext, onPrev, onDelete, onAdd, onToggleMode, onBack }: any) {
//   const [searchQuery, setSearchQuery] = useState('');
//   const getModeIcon = () => {
//     switch(playbackMode) {
//       case 'loop_one': return 'repeat-once';
//       case 'loop_all': return 'repeat';
//       case 'play_one': return 'numeric-1-box-outline';
//       case 'play_all': return 'playlist-play';
//       default: return 'repeat';
//     }
//   };
//   const filteredPlaylist = playlist.filter((track: MusicTrack) => track.title.toLowerCase().includes(searchQuery.toLowerCase()));

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}>
//         <TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>MUSIC PLAYER</Text>
//         <TouchableOpacity onPress={onToggleMode} style={styles.modeBtnHeader}><MaterialCommunityIcons name={getModeIcon()} size={20} color={COLORS.blue} /></TouchableOpacity>
//       </View>
//       <View style={styles.playerMain}>
//         {currentTrack && currentTrack.artwork ? ( <Image source={{uri: currentTrack.artwork}} style={styles.albumArt} /> ) : ( <View style={styles.albumArtPlaceholder}><Ionicons name="musical-note" size={80} color={COLORS.highlight} /></View> )}
//         <Text style={styles.nowPlayingTitle} numberOfLines={1}>{currentTrack ? currentTrack.title : 'Select a Track'}</Text>
//         <View style={styles.seekContainer}>
//           <Text style={styles.timeText}>{formatTime(position)}</Text>
//           <Slider style={{flex: 1, marginHorizontal: 10}} minimumValue={0} maximumValue={duration > 0 ? duration : 1} value={position} minimumTrackTintColor={COLORS.highlight} maximumTrackTintColor={COLORS.accent} thumbTintColor={COLORS.blue} onSlidingComplete={onSeek} />
//           <Text style={styles.timeText}>{formatTime(duration)}</Text>
//         </View>
//         <View style={styles.playerControlsMain}>
//            <TouchableOpacity onPress={onPrev} style={styles.ctrlBtn}><Ionicons name="play-skip-back" size={30} color={COLORS.text} /></TouchableOpacity>
//            <TouchableOpacity onPress={onPause} style={styles.playButtonLarge}>{isLoading ? ( <View style={{width: 30, height: 30, borderWidth: 3, borderRadius: 15, borderColor: COLORS.primary, borderTopColor: COLORS.blue}} /> ) : ( <Ionicons name={isPlaying ? "pause" : "play"} size={40} color={COLORS.primary} /> )}</TouchableOpacity>
//            <TouchableOpacity onPress={onNext} style={styles.ctrlBtn}><Ionicons name="play-skip-forward" size={30} color={COLORS.text} /></TouchableOpacity>
//         </View>
//       </View>
//       <View style={styles.playlistHeader}><Text style={styles.sectionTitle}>PLAYLIST</Text><TouchableOpacity onPress={onAdd} style={styles.addBtn}><Ionicons name="add" size={20} color={COLORS.primary} /></TouchableOpacity></View>
//       <View style={{paddingHorizontal: 20, marginBottom: 5}}><View style={styles.searchContainer}><Ionicons name="search" size={20} color={COLORS.textDark} /><TextInput style={styles.searchInput} placeholder="Search tracks..." placeholderTextColor={COLORS.textDark} value={searchQuery} onChangeText={setSearchQuery} /></View></View>
//       <ScrollView style={styles.playlistContainer}>
//         {filteredPlaylist.map((track: MusicTrack) => (
//           <View key={track.id} style={[styles.trackRow, currentTrack?.id === track.id && styles.trackActive]}>
//             <TouchableOpacity style={styles.trackInfoArea} onPress={() => onPlay(track)}>
//               <View style={styles.trackIcon}><Ionicons name="musical-notes-outline" size={20} color={currentTrack?.id === track.id ? COLORS.white : COLORS.textDark} /></View>
//               <Text style={[styles.trackName, currentTrack?.id === track.id && styles.trackNameActive]} numberOfLines={1}>{track.title}</Text>
//             </TouchableOpacity>
//             <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(track.id)}><Ionicons name="trash-outline" size={18} color={COLORS.danger} /></TouchableOpacity>
//           </View>
//         ))}
//       </ScrollView>
//     </View>
//   );
// }

// function TrainingScreen({ userData, quest, onComplete, onBack, showAlert }: any) {
//   const [counts, setCounts] = useState<TrainingResult>({});
//   const [permission, requestPermission] = useCameraPermissions();
//   const [cameraType, setCameraType] = useState('front'); 
//   const [workoutTime, setWorkoutTime] = useState(0);
//   const [activeExercise, setActiveExercise] = useState<string | null>(null);
//   const [manualInputs, setManualInputs] = useState<{[key:string]: string}>({});
  
//   const cameraRef = useRef<any>(null);

//   useEffect(() => {
//     if (!permission) requestPermission();
//     const initCounts: any = {}; Object.keys(quest.exercises).forEach(k => initCounts[k] = 0); setCounts(initCounts);
//   }, [permission]);

//   // Workout Timer
//   useEffect(() => {
//     const timer = setInterval(() => {
//         setWorkoutTime(t => t + 1);
//     }, 1000);
//     return () => clearInterval(timer);
//   }, []);

//   const handleManualAdd = (ex: string, target: number) => { 
//       const amount = parseInt(manualInputs[ex] || '0');
//       if (amount > 0) {
//           const current = counts[ex] || 0; 
//           const newVal = Math.min(current + amount, target);
//           setCounts({...counts, [ex]: newVal});
//           setManualInputs({...manualInputs, [ex]: ''});
//       }
//   };

//   const handleDecrease = (ex: string) => {
//       const current = counts[ex] || 0;
//       if (current > 0) setCounts({...counts, [ex]: current - 1});
//   };

//   const handleCheckAll = () => {
//     showAlert("Complete All?", "Mark all exercises as finished?", [
//         { text: "Cancel", style: "cancel" },
//         { text: "Yes", onPress: () => setCounts(quest.exercises) }
//     ]);
//   };

//   const isCompleted = (ex: string) => (counts[ex] || 0) >= quest.exercises[ex];
//   const allCompleted = Object.keys(quest.exercises).every(isCompleted);

//   // Determine if active exercise is supported by pose detection logic
//   const isPoseSupported = (exKey: string) => PoseCalculator.isSupported(exKey);

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}>
//         <TouchableOpacity onPress={onBack}><Ionicons name="close" size={24} color={COLORS.danger} /></TouchableOpacity>
//         <Text style={styles.headerTitle}>DUNGEON INSTANCE</Text>
//         <View style={styles.timerBadge}>
//              <Ionicons name="timer-outline" size={16} color={COLORS.gold} />
//              <Text style={styles.timerValue}>{formatTime(workoutTime)}</Text>
//         </View>
//         <TouchableOpacity onPress={() => setCameraType(cameraType === 'back' ? 'front' : 'back')}><Ionicons name="camera-reverse" size={24} color={COLORS.blue} /></TouchableOpacity>
//       </View>
      
//       {userData.cameraEnabled && (
//         <View style={styles.cameraContainer}>
//           {permission?.granted ? (
//             <CameraView style={styles.camera} facing={cameraType as any} ref={cameraRef}>
//                <View style={styles.cameraOverlay}>
//                   <Text style={styles.detectionText}>SYSTEM: POSE TRACKING ACTIVE</Text>
                  
//                   {activeExercise && !isPoseSupported(activeExercise) ? (
//                       <View style={styles.camWarningBox}>
//                           <Text style={styles.camWarningText}>CANNOT DETECT WITH CAM</Text>
//                       </View>
//                   ) : (
//                       <View style={styles.poseBox} />
//                   )}
  
//                   {activeExercise && isPoseSupported(activeExercise) && (
//                       <View style={styles.poseInfoBox}>
//                           <Text style={styles.poseInfoText}>Detecting: {EXERCISES[activeExercise]?.name || activeExercise}</Text>
//                           <Text style={styles.poseInfoSub}>Ensure full body visibility</Text>
//                       </View>
//                   )}
//                </View>
//             </CameraView>
//           ) : (
//              <View style={styles.cameraOff}>
//                  <Ionicons name="videocam-off" size={40} color={COLORS.textDark} />
//                  <Text style={styles.cameraOffText}>CAMERA DISABLED</Text>
//                  <Text style={styles.cameraOffSub}>Enable in Settings for Auto-Count</Text>
//              </View>
//           )}
//         </View>
//       )}

//       <ScrollView style={styles.exerciseList} contentContainerStyle={{paddingBottom: 20}}>
//         {Object.entries(quest.exercises).map(([key, target]: [string, any]) => {
//           const def = quest.customExercises?.[key] || EXERCISES[key] || { name: key, iconName: 'help', iconLib: 'Ionicons' };
//           const count = counts[key] || 0;
//           const completed = isCompleted(key);
          
//           return (
//             <TouchableOpacity 
//                 key={key} 
//                 style={[styles.exerciseCard, completed && styles.exerciseCardDone, activeExercise === key && styles.exerciseCardActive]}
//                 onPress={() => setActiveExercise(key)}
//             >
//               <View style={styles.exHeaderRow}>
//                  <View style={styles.exIcon}><SoloIcon name={def.iconName} lib={def.iconLib} size={28} color={COLORS.blue} /></View>
//                  <View style={{flex: 1}}>
//                     <Text style={styles.exName}>{def.name}</Text>
//                     <View style={styles.progressBarBg}><View style={[styles.progressBarFill, {width: `${Math.min((count/target)*100, 100)}%`}]} /></View>
//                  </View>
//                  <Text style={styles.countTextLarge}>{count}/{target}</Text>
//               </View>

//               <View style={styles.seriesControls}>
//                  <TouchableOpacity style={styles.seriesBtnSmall} onPress={() => handleDecrease(key)} disabled={count === 0}>
//                     <Ionicons name="remove" size={16} color={COLORS.white} />
//                  </TouchableOpacity>
                 
//                  <TextInput 
//                     style={styles.seriesInput} 
//                     placeholder="#" 
//                     placeholderTextColor={COLORS.textDark}
//                     keyboardType="numeric"
//                     value={manualInputs[key] || ''}
//                     onChangeText={(t) => setManualInputs({...manualInputs, [key]: t})}
//                  />
                 
//                  <TouchableOpacity style={styles.seriesBtn} onPress={() => handleManualAdd(key, target)} disabled={completed}>
//                     <Text style={styles.seriesBtnText}>ADD SET</Text>
//                  </TouchableOpacity>
                 
//                  <TouchableOpacity style={[styles.checkBtn, completed ? styles.checkBtnDone : {}]} onPress={() => setCounts({...counts, [key]: target})}>
//                     <Ionicons name="checkmark" size={18} color={COLORS.white} />
//                  </TouchableOpacity>
//               </View>
//             </TouchableOpacity>
//           );
//         })}
//         <TouchableOpacity style={styles.checkAllBtn} onPress={handleCheckAll}>
//             <Text style={styles.checkAllText}>COMPLETE ALL EXERCISES</Text>
//         </TouchableOpacity>
        
//         {allCompleted && ( <TouchableOpacity style={styles.completeBtn} onPress={() => onComplete(counts, workoutTime)}><Text style={styles.completeBtnText}>COMPLETE DUNGEON</Text></TouchableOpacity> )}
//       </ScrollView>
//     </View>
//   );
// }

// function CustomProgramsScreen({ userData, customPrograms, setCustomPrograms, onBack, onStartProgram, showAlert }: any) {
//   const [modalVisible, setModalVisible] = useState(false);
//   const [newProgName, setNewProgName] = useState('');
//   const [editingId, setEditingId] = useState<string | null>(null);
//   const [selectedEx, setSelectedEx] = useState<{[key:string]: number}>({});
//   const [customList, setCustomList] = useState<Array<{id: string, name: string, reps: number}>>([]);
//   const [customExName, setCustomExName] = useState('');
//   const [customExCount, setCustomExCount] = useState('10');
//   const [schedule, setSchedule] = useState<string[]>([]); // New schedule state

//   const toggleExercise = (key: string) => { const next = {...selectedEx}; if (next[key]) delete next[key]; else next[key] = 10; setSelectedEx(next); };
//   const updateReps = (key: string, val: string) => { const next = {...selectedEx, [key]: parseInt(val) || 0}; setSelectedEx(next); };

//   const addCustomExercise = () => {
//     if (!customExName) { showAlert("Error", "Enter name"); return; }
//     const newEx = { id: `cust_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, name: customExName, reps: parseInt(customExCount) || 10 };
//     setCustomList([...customList, newEx]); setCustomExName(''); setCustomExCount('10');
//   };

//   const removeCustomExercise = (id: string) => { setCustomList(customList.filter(item => item.id !== id)); };

//   const toggleDay = (day: string) => {
//       if (schedule.includes(day)) setSchedule(schedule.filter(d => d !== day));
//       else setSchedule([...schedule, day]);
//   };

//   const openCreateModal = () => {
//     setNewProgName(''); setEditingId(null); setSelectedEx({}); setCustomList([]); setSchedule([]); setModalVisible(true);
//   };

//   const openEditModal = (prog: CustomProgram) => {
//     setNewProgName(prog.name); setEditingId(prog.id); setSchedule(prog.schedule || []);
//     const stdEx: {[key:string]: number} = {}; const cList: Array<{id: string, name: string, reps: number}> = [];
//     Object.entries(prog.exercises).forEach(([key, reps]) => {
//         if(EXERCISES[key]) stdEx[key] = reps;
//         else if (prog.customExercises && prog.customExercises[key]) cList.push({ id: key, name: prog.customExercises[key].name, reps: reps });
//     });
//     setSelectedEx(stdEx); setCustomList(cList); setModalVisible(true);
//   };

//   const saveProgram = () => {
//     if (!newProgName) { showAlert("Error", "Name required"); return; }
//     let customDefs: ExerciseConfig = {}; let finalExercises = { ...selectedEx };
//     customList.forEach(item => { customDefs[item.id] = { name: item.name, iconName: 'star', iconLib: 'Ionicons', custom: true, type: 'reps' }; finalExercises[item.id] = item.reps; });
//     const newProg: CustomProgram = { id: editingId ? editingId : Date.now().toString(), name: newProgName, exercises: finalExercises, customExercises: customDefs, schedule: schedule, createdAt: new Date().toISOString() };
//     let updated; if(editingId) updated = customPrograms.map((p: any) => p.id === editingId ? newProg : p); else updated = [...customPrograms, newProg];
//     setCustomPrograms(updated); setModalVisible(false);
//   };

//   const deleteProgram = (id: string) => { const updated = customPrograms.filter((p: any) => p.id !== id); setCustomPrograms(updated); };

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}>
//         <TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>CUSTOM PROGRAMS</Text>
//         <TouchableOpacity onPress={openCreateModal}><Ionicons name="add-circle" size={30} color={COLORS.blue} /></TouchableOpacity>
//       </View>
//       <ScrollView style={{padding: 20}}>
//         {customPrograms.map((p: any) => (
//            <View key={p.id} style={styles.programCard}>
//               <View style={{flex: 1}}>
//                 <Text style={styles.progTitle}>{p.name}</Text>
//                 <Text style={styles.progSub}>{Object.keys(p.exercises).length} Exercises</Text>
//                 {p.schedule && p.schedule.length > 0 && <Text style={{color: COLORS.gold, fontSize: 10}}>Scheduled: {p.schedule.join(', ')}</Text>}
//               </View>
//               <TouchableOpacity style={styles.startBtnSmall} onPress={() => onStartProgram({ title: p.name, difficulty: 1, exercises: p.exercises, rewards: { xp: 100, title: 'Custom' }, customExercises: p.customExercises, isDaily: false })}>
//                  <Text style={styles.btnTextSmall}>START</Text>
//               </TouchableOpacity>
//               <TouchableOpacity style={styles.editProgBtn} onPress={() => openEditModal(p)}><Ionicons name="create-outline" size={20} color={COLORS.white} /></TouchableOpacity>
//               <TouchableOpacity style={styles.deleteProgBtn} onPress={() => deleteProgram(p.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger} /></TouchableOpacity>
//            </View>
//         ))}
//       </ScrollView>
//       <Modal visible={modalVisible} animationType="slide" transparent>
//         <View style={styles.modalOverlay}>
//            <View style={styles.createModal}>
//               <Text style={styles.modalTitle}>{editingId ? 'EDIT PROGRAM' : 'NEW PROGRAM'}</Text>
//               <TextInput style={styles.input} placeholder="Program Name" placeholderTextColor={COLORS.textDark} value={newProgName} onChangeText={setNewProgName} />
              
//               <Text style={[styles.label, {marginTop: 10}]}>Schedule as Daily Quest:</Text>
//               <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10}}>
//                   {WEEK_DAYS.map(day => (
//                       <TouchableOpacity key={day} onPress={() => toggleDay(day)} style={[styles.dayBtn, schedule.includes(day) && styles.dayBtnActive]}>
//                           <Text style={[styles.dayBtnText, schedule.includes(day) && {color: COLORS.white}]}>{day.charAt(0)}</Text>
//                       </TouchableOpacity>
//                   ))}
//               </View>

//               <ScrollView style={{height: 200, marginVertical: 10}}>
//                  {Object.entries(EXERCISES).map(([k, v]) => (
//                     <View key={k} style={styles.selectRowContainer}>
//                         <Text style={styles.rowLabel}>{v.name}</Text>
//                         <View style={{flexDirection:'row', alignItems:'center'}}>
//                           {selectedEx[k] ? ( <TextInput style={styles.repsInput} keyboardType="numeric" value={String(selectedEx[k])} onChangeText={(val) => updateReps(k, val)} /> ) : null}
//                           <TouchableOpacity style={[styles.checkboxBtn, selectedEx[k] ? styles.checkboxActive : {}]} onPress={() => toggleExercise(k)}><Ionicons name={selectedEx[k] ? "remove" : "add"} size={20} color={selectedEx[k] ? COLORS.white : COLORS.blue} /></TouchableOpacity>
//                         </View>
//                     </View>
//                  ))}
//                  {customList.length > 0 && <Text style={[styles.label, {marginTop: 15}]}>Added Custom:</Text>}
//                  {customList.map((item) => (
//                     <View key={item.id} style={styles.selectRowContainer}>
//                         <View style={{flex:1}}><Text style={styles.rowLabel}>{item.name} ({item.reps} reps)</Text></View>
//                         <TouchableOpacity style={styles.deleteBtn} onPress={() => removeCustomExercise(item.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger} /></TouchableOpacity>
//                     </View>
//                  ))}
//               </ScrollView>
              
//               <View style={{borderTopWidth: 1, borderTopColor: COLORS.accent, paddingTop: 10}}>
//                  <Text style={styles.label}>Add Custom Exercise:</Text>
//                  <View style={styles.row}>
//                     <TextInput style={[styles.input, {flex: 2, marginRight: 5}]} placeholder="Name" placeholderTextColor={COLORS.textDark} value={customExName} onChangeText={setCustomExName} />
//                     <TextInput style={[styles.input, {flex: 1, marginRight: 5}]} keyboardType="numeric" placeholder="Reps" placeholderTextColor={COLORS.textDark} value={customExCount} onChangeText={setCustomExCount} />
//                     <TouchableOpacity style={styles.addCustomBtn} onPress={addCustomExercise}><Ionicons name="add" size={24} color={COLORS.white} /></TouchableOpacity>
//                  </View>
//               </View>

//               <View style={[styles.row, {marginTop: 10}]}>
//                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}><Text style={styles.btnText}>CANCEL</Text></TouchableOpacity>
//                  <TouchableOpacity style={styles.saveBtn} onPress={saveProgram}><Text style={styles.btnText}>SAVE</Text></TouchableOpacity>
//               </View>
//            </View>
//         </View>
//       </Modal>
//     </View>
//   );
// }

// function StatsScreen({ userData, onBack }: any) {
//   const [data, setData] = useState<number[]>([0]);
//   useEffect(() => { 
//     AsyncStorage.getItem('trainingHistory').then(h => { 
//         if(h) { 
//             const history = JSON.parse(h); 
//             // Group by date (YYYY-MM-DD) and sum XP
//             const grouped: {[key: string]: number} = {};
//             history.forEach((entry: TrainingHistory) => {
//                 const dateKey = entry.date.split('T')[0];
//                 grouped[dateKey] = (grouped[dateKey] || 0) + entry.xpGained;
//             });
//             // Sort by date key to ensure order
//             const sortedKeys = Object.keys(grouped).sort();
//             const xpData = sortedKeys.map(k => grouped[k]);
            
//             // Slice last 6 or default to [0]
//             if(xpData.length > 0) setData(xpData.slice(-6));
//             else setData([0]);
//         } 
//     }); 
//   }, []);
  
//   return (
//     <ScrollView style={styles.screenContainer}>
//        <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>STATISTICS</Text><View style={{width: 24}} /></View>
//       <View style={{padding: 20}}>
//         <Text style={styles.sectionTitle}>XP GAIN HISTORY</Text>
//         <LineChart
//           data={{ labels: ["1", "2", "3", "4", "5", "6"], datasets: [{ data: data }] }}
//           width={width - 40} height={220} yAxisLabel="" yAxisSuffix=" XP"
//           chartConfig={{
//             backgroundColor: COLORS.secondary, backgroundGradientFrom: COLORS.secondary, backgroundGradientTo: COLORS.accent,
//             decimalPlaces: 0, color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`, labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
//             style: { borderRadius: 16 }, propsForDots: { r: "6", strokeWidth: "2", stroke: COLORS.glow }
//           }}
//           style={{ marginVertical: 8, borderRadius: 16 }}
//         />
//         <View style={styles.statBoxLarge}><Text style={styles.bigStat}>{userData.totalWorkouts}</Text><Text style={styles.bigStatLbl}>TOTAL DUNGEONS CLEARED</Text></View>
//       </View>
//     </ScrollView>
//   );
// }

// function QuestScreen({ userData, customPrograms, onBack, onStartTraining }: any) {
//    // Generate Quest based on Goal and Level AND Schedule
//    const getDailyQuest = (): Quest => {
//       const todayDay = getDayString(new Date());
      
//       // 1. Check for Scheduled Custom Program
//       const scheduledProg = customPrograms.find((p: CustomProgram) => p.schedule && p.schedule.includes(todayDay));
//       if (scheduledProg) {
//           // Calculate XP based on level scaling roughly (standard reward for daily)
//           return {
//               title: `DAILY: ${scheduledProg.name.toUpperCase()}`,
//               difficulty: Math.floor(userData.level / 5) + 1,
//               exercises: scheduledProg.exercises,
//               customExercises: scheduledProg.customExercises,
//               rewards: { xp: userData.level * 150, title: 'Hunter' }, // High reward for scheduled custom
//               isDaily: true
//           };
//       }

//       // 2. Fallback to Standard Logic
//       const level = userData.level;
//       let exercises: {[key:string]: number} = {};
//       let title = "DAILY QUEST";
//       let rewardXP = level * 100; // Base reward

//       if (userData.goal === 'speed_strength') {
//           title = "ASSASSIN TRAINING";
//           exercises = { clapPushups: Math.ceil(level * 5), jumpSquats: Math.ceil(level * 10), situps: Math.ceil(level * 10), running: Math.min(1 + (level * 0.2), 5) };
//       } else if (userData.goal === 'weight_loss') {
//           title = "ENDURANCE TRIAL";
//           exercises = { squats: level * 15, situps: level * 15, burpees: level * 5, running: Math.min(2 + (level * 0.5), 10) };
//       } else {
//           title = "STRENGTH TRAINING";
//           exercises = { pushups: level * 10, squats: level * 10, situps: level * 10, pullups: Math.ceil(level * 2) };
//       }

//       return { title, difficulty: Math.floor(level / 5) + 1, exercises, rewards: { xp: rewardXP, title: 'Hunter' }, isDaily: true };
//    };

//    const dailyQuest = getDailyQuest();

//    return (
//       <View style={styles.screenContainer}>
//          <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>QUEST INFO</Text><View style={{width: 24}} /></View>
//          <View style={styles.questPaperDark}>
//             <Text style={styles.questTitleDark}>{dailyQuest.title}</Text>
//             <Text style={styles.difficulty}>Rank: {'★'.repeat(dailyQuest.difficulty)}</Text>
//             <View style={styles.divider} />
//             <Text style={styles.objTitleDark}>OBJECTIVES:</Text>
//             {Object.entries(dailyQuest.exercises).map(([k, v]) => (
//                <View key={k} style={styles.objRow}>
//                   <View style={{flexDirection: 'row', alignItems: 'center'}}>
//                      <View style={{width: 6, height: 6, backgroundColor: COLORS.blue, marginRight: 8}} />
//                      <Text style={styles.objTextDark}>{(dailyQuest.customExercises?.[k]?.name) || EXERCISES[k]?.name || k}</Text>
//                   </View>
//                   <Text style={styles.objValDark}>{v} {EXERCISES[k]?.type === 'distance' ? 'km' : ''}</Text>
//                </View>
//             ))}
//             <View style={styles.divider} />
//             <Text style={styles.rewardTitleDark}>REWARDS:</Text>
//             <Text style={styles.rewardText}>+ {dailyQuest.rewards.xp} XP</Text>
//          </View>
//          <TouchableOpacity style={[styles.acceptBtn, userData.lastDailyQuestCompleted === getISODate(new Date()) ? {backgroundColor: COLORS.textDark} : {}]} disabled={userData.lastDailyQuestCompleted === getISODate(new Date())} onPress={() => onStartTraining(dailyQuest)}>
//             <Text style={styles.acceptBtnText}>{userData.lastDailyQuestCompleted === getISODate(new Date()) ? 'QUEST COMPLETE' : 'ACCEPT QUEST'}</Text>
//          </TouchableOpacity>
//       </View>
//    );
// }

// function SettingsScreen({ userData, onSave, onBack }: any) {
//   const [camEnabled, setCamEnabled] = useState(userData.cameraEnabled);
//   const [name, setName] = useState(userData.name);
//   const [image, setImage] = useState(userData.profileImage);
//   const pickImage = async () => { let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5 }); if (!result.canceled) setImage(result.assets[0].uri); };
//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>SYSTEM SETTINGS</Text><View style={{width:24}} /></View>
//       <ScrollView style={{padding: 20}}>
//          <View style={{alignItems: 'center', marginBottom: 20}}>
//             <TouchableOpacity onPress={pickImage}><Image source={image ? { uri: image } : { uri: 'https://via.placeholder.com/150' }} style={styles.settingsAvatar} /><View style={styles.editIconBadge}><Ionicons name="camera" size={14} color={COLORS.white} /></View></TouchableOpacity>
//             <Text style={[styles.label, {marginTop: 10}]}>EDIT HUNTER NAME</Text><TextInput style={[styles.input, {textAlign: 'center', width: '80%'}]} value={name} onChangeText={setName} placeholder="Hunter Name" placeholderTextColor={COLORS.textDark} />
//          </View>
//          <View style={styles.divider} />
//          <View style={styles.settingRow}><Text style={styles.settingText}>Enable Pose Detection (Camera)</Text><TouchableOpacity onPress={() => setCamEnabled(!camEnabled)}><Ionicons name={camEnabled ? "checkbox" : "square-outline"} size={28} color={COLORS.blue} /></TouchableOpacity></View>
//          <TouchableOpacity style={styles.settingsSaveBtn} onPress={() => onSave({...userData, cameraEnabled: camEnabled, name: name, profileImage: image})}><Text style={styles.settingsSaveBtnText}>SAVE CHANGES</Text></TouchableOpacity>
//       </ScrollView>
//     </View>
//   );
// }

// // --- Helpers ---
// const formatTime = (seconds: number) => {
//   const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60);
//   return `${m}:${s < 10 ? '0' : ''}${s}`;
// };

// // --- Styles ---
// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: COLORS.primary },
//   screenContainer: { flex: 1, backgroundColor: COLORS.primary },
//   centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.primary },
//   loadingTitle: { fontSize: 32, fontWeight: '900', color: COLORS.blue, letterSpacing: 4 },
//   loadingSubtitle: { color: COLORS.textDark, marginTop: 10, letterSpacing: 2 },
//   header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: COLORS.accent },
//   headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', letterSpacing: 1.5 },
//   timerBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: COLORS.gold },
//   timerValue: { color: COLORS.gold, fontWeight: 'bold', marginLeft: 5, fontSize: 12 },
//   avatarPicker: { alignSelf: 'center', marginVertical: 20 },
//   avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: COLORS.accent, justifyContent: 'center', alignItems: 'center', borderStyle: 'dashed', borderWidth: 1, borderColor: COLORS.textDark },
//   avatarImage: { width: 100, height: 100, borderRadius: 50 },
//   avatarText: { fontSize: 10, color: COLORS.textDark, marginTop: 5 },
//   formGroup: { marginBottom: 15 },
//   row: { flexDirection: 'row', justifyContent: 'space-between' },
//   label: { color: COLORS.blue, fontSize: 12, marginBottom: 5, fontWeight: 'bold' },
//   input: { backgroundColor: COLORS.secondary, color: COLORS.text, padding: 15, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent },
//   genderContainer: { flexDirection: 'row', justifyContent: 'space-between' },
//   genderBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15, backgroundColor: COLORS.secondary, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent, marginHorizontal: 5 },
//   genderBtnActive: { backgroundColor: COLORS.blue, borderColor: COLORS.glow },
//   genderText: { color: COLORS.blue, fontWeight: 'bold', marginLeft: 8 },
//   genderTextActive: { color: COLORS.white, fontWeight: 'bold', marginLeft: 8 },
//   goalBtn: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: COLORS.secondary, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent, marginBottom: 8 },
//   goalBtnActive: { backgroundColor: COLORS.blue, borderColor: COLORS.glow },
//   goalText: { color: COLORS.blue, fontWeight: 'bold', marginLeft: 15 },
//   goalTextActive: { color: COLORS.white, fontWeight: 'bold', marginLeft: 15 },
//   mainButton: { backgroundColor: COLORS.blue, padding: 18, borderRadius: 8, alignItems: 'center', marginTop: 20 },
//   mainButtonText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 16, letterSpacing: 2 },
//   dashboardHeader: { padding: 20, paddingTop: 10 },
//   profileRow: { flexDirection: 'row', alignItems: 'center' },
//   profileImageSmall: { width: 60, height: 60, borderRadius: 30, marginRight: 15, borderWidth: 2, borderColor: COLORS.blue },
//   playerName: { color: COLORS.text, fontSize: 22, fontWeight: 'bold' },
//   playerRank: { color: COLORS.glow, fontSize: 12, letterSpacing: 1 },
//   systemWindow: { margin: 20, padding: 20, backgroundColor: COLORS.secondary, borderRadius: 12, borderWidth: 1, borderColor: COLORS.blue },
//   systemHeader: { color: COLORS.text, textAlign: 'center', fontWeight: 'bold', marginBottom: 15 },
//   xpBarContainer: { height: 6, backgroundColor: COLORS.accent, borderRadius: 3, marginBottom: 5 },
//   xpBarFill: { height: '100%', backgroundColor: COLORS.blue, borderRadius: 3 },
//   xpText: { color: COLORS.textDark, fontSize: 10, textAlign: 'right', marginBottom: 15 },
//   statGrid: { flexDirection: 'row', justifyContent: 'space-around' },
//   statItem: { alignItems: 'center' },
//   statVal: { color: COLORS.text, fontSize: 18, fontWeight: 'bold' },
//   statLbl: { color: COLORS.textDark, fontSize: 10 },
//   menuGrid: { padding: 20 },
//   menuCardLarge: { backgroundColor: COLORS.accent, padding: 20, borderRadius: 12, alignItems: 'center', marginBottom: 15, borderWidth: 1, borderColor: COLORS.gold },
//   menuTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', marginTop: 10 },
//   menuSub: { color: COLORS.danger, fontSize: 12 },
//   menuRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
//   menuCardSmall: { backgroundColor: COLORS.secondary, width: '48%', padding: 15, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.accent },
//   menuTitleSmall: { color: COLORS.text, marginTop: 5, fontSize: 12 },
//   playerMain: { alignItems: 'center', padding: 20 },
//   albumArtPlaceholder: { width: 140, height: 140, backgroundColor: COLORS.secondary, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 15, borderWidth: 1, borderColor: COLORS.accent },
//   albumArt: { width: 140, height: 140, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: COLORS.accent },
//   nowPlayingTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', marginBottom: 10, textAlign: 'center' },
//   seekContainer: { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 15 },
//   timeText: { color: COLORS.textDark, fontSize: 10, width: 35, textAlign: 'center' },
//   playerControlsMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', width: '80%' },
//   playButtonLarge: { width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.blue, justifyContent: 'center', alignItems: 'center' },
//   ctrlBtn: { padding: 10 },
//   modeBtnHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, padding: 5, borderRadius: 5, borderWidth: 1, borderColor: COLORS.accent },
//   playlistHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginTop: 10 },
//   sectionTitle: { color: COLORS.blue, fontWeight: 'bold' },
//   addBtn: { backgroundColor: COLORS.highlight, padding: 5, borderRadius: 4 },
//   searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: COLORS.accent, marginTop: 10 },
//   searchInput: { flex: 1, color: COLORS.text, marginLeft: 10, paddingVertical: 5 },
//   playlistContainer: { padding: 20 },
//   trackRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.accent, justifyContent: 'space-between' },
//   trackActive: { backgroundColor: COLORS.accent },
//   trackInfoArea: { flexDirection: 'row', alignItems: 'center', flex: 1 },
//   trackIcon: { width: 30 },
//   trackName: { color: COLORS.textDark, flex: 1, fontSize: 14, marginLeft: 5 },
//   trackNameActive: { color: COLORS.white, fontWeight: 'bold', textShadowColor: COLORS.glow, textShadowRadius: 8 },
//   deleteBtn: { padding: 5 },
//   miniPlayerContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 70, backgroundColor: COLORS.secondary, borderTopWidth: 1, borderTopColor: COLORS.blue, zIndex: 999 },
//   miniProgressContainer: { height: 2, backgroundColor: COLORS.accent, width: '100%' },
//   miniProgressFill: { height: '100%', backgroundColor: COLORS.highlight },
//   miniPlayerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, flex: 1 },
//   miniInfo: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 10 },
//   miniArt: { width: 40, height: 40, borderRadius: 4, marginRight: 10 },
//   miniTitle: { color: COLORS.white, fontWeight: 'bold', fontSize: 14 },
//   miniTime: { color: COLORS.textDark, fontSize: 10 },
//   miniControls: { flexDirection: 'row', alignItems: 'center' },
//   miniCtrlBtn: { marginHorizontal: 8 },
//   cameraContainer: { height: 250, backgroundColor: '#000', overflow: 'hidden' },
//   camera: { flex: 1 },
//   cameraOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
//   detectionText: { color: COLORS.success, fontSize: 10, position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', padding: 4 },
//   poseBox: { width: 200, height: 300, borderWidth: 2, borderColor: COLORS.glow, opacity: 0.5 },
//   camWarningBox: { backgroundColor: 'rgba(239, 68, 68, 0.8)', padding: 10, borderRadius: 5 },
//   camWarningText: { color: COLORS.white, fontWeight: 'bold' },
//   poseInfoBox: { position: 'absolute', bottom: 10, left: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 10, borderRadius: 5 },
//   poseInfoText: { color: COLORS.success, fontWeight: 'bold', fontSize: 12 },
//   poseInfoSub: { color: COLORS.textDark, fontSize: 10 },
//   cameraOff: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.secondary },
//   cameraOffText: { color: COLORS.text, fontWeight: 'bold', marginTop: 10 },
//   cameraOffSub: { color: COLORS.textDark, fontSize: 10 },
//   exerciseList: { flex: 1, padding: 20 },
//   exerciseCard: { backgroundColor: COLORS.secondary, padding: 15, marginBottom: 10, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent },
//   exerciseCardActive: { borderColor: COLORS.blue, backgroundColor: '#1e293b' },
//   exerciseCardDone: { opacity: 0.6, borderColor: COLORS.success },
//   exHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
//   exIcon: { width: 40 },
//   exName: { color: COLORS.text, fontWeight: 'bold', marginBottom: 5 },
//   progressBarBg: { height: 4, backgroundColor: COLORS.accent, borderRadius: 2, width: '90%' },
//   progressBarFill: { height: '100%', backgroundColor: COLORS.blue, borderRadius: 2 },
//   countTextLarge: { color: COLORS.white, fontSize: 16, fontWeight: 'bold' },
//   seriesControls: { flexDirection: 'row', alignItems: 'center', marginTop: 5, justifyContent: 'flex-end' },
//   seriesInput: { width: 50, height: 35, backgroundColor: COLORS.primary, color: COLORS.white, textAlign: 'center', borderRadius: 4, borderWidth: 1, borderColor: COLORS.accent, marginHorizontal: 5 },
//   seriesBtn: { backgroundColor: COLORS.blue, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 4, marginHorizontal: 5 },
//   seriesBtnSmall: { backgroundColor: COLORS.accent, width: 35, height: 35, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
//   seriesBtnText: { color: COLORS.white, fontSize: 10, fontWeight: 'bold' },
//   checkBtn: { width: 35, height: 35, borderRadius: 17.5, borderWidth: 1, borderColor: COLORS.textDark, alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
//   checkBtnDone: { backgroundColor: COLORS.success, borderColor: COLORS.success },
//   checkAllBtn: { marginVertical: 10, padding: 10, borderWidth: 1, borderColor: COLORS.blue, borderRadius: 8, alignItems: 'center' },
//   checkAllText: { color: COLORS.blue, fontSize: 12, fontWeight: 'bold', letterSpacing: 1 },
//   completeBtn: { backgroundColor: COLORS.blue, margin: 20, padding: 15, borderRadius: 8, alignItems: 'center' },
//   completeBtnText: { color: COLORS.primary, fontWeight: 'bold', letterSpacing: 2 },
//   programCard: { backgroundColor: COLORS.secondary, padding: 15, borderRadius: 8, marginBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
//   progTitle: { color: COLORS.text, fontSize: 16, fontWeight: 'bold' },
//   progSub: { color: COLORS.textDark, fontSize: 12 },
//   startBtnSmall: { backgroundColor: COLORS.success, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4, marginRight: 10 },
//   editProgBtn: { backgroundColor: COLORS.accent, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4, marginRight: 10 },
//   deleteProgBtn: { padding: 5 },
//   btnTextSmall: { color: COLORS.primary, fontWeight: 'bold', fontSize: 10 },
//   modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
//   createModal: { backgroundColor: COLORS.secondary, padding: 20, borderRadius: 12, borderWidth: 1, borderColor: COLORS.blue },
//   modalTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 15 },
//   selectRowContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: COLORS.accent },
//   rowLabel: { color: COLORS.textDark, fontSize: 16 },
//   repsInput: { backgroundColor: COLORS.primary, color: COLORS.white, width: 50, padding: 5, borderRadius: 4, textAlign: 'center', borderWidth: 1, borderColor: COLORS.blue, marginRight: 10 },
//   checkboxBtn: { padding: 5, borderRadius: 4, borderWidth: 1, borderColor: COLORS.blue },
//   checkboxActive: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
//   addCustomBtn: { backgroundColor: COLORS.blue, padding: 10, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
//   cancelBtn: { flex: 1, padding: 15, alignItems: 'center', marginRight: 10 },
//   saveBtn: { flex: 1, backgroundColor: COLORS.blue, padding: 15, alignItems: 'center', borderRadius: 6 },
//   btnText: { color: COLORS.text, fontWeight: 'bold' },
//   settingsSaveBtn: { backgroundColor: COLORS.blue, padding: 18, borderRadius: 8, alignItems: 'center', marginTop: 30 },
//   settingsSaveBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },
//   settingsAvatar: { width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: COLORS.blue, marginBottom: 10 },
//   editIconBadge: { position: 'absolute', bottom: 10, right: 10, backgroundColor: COLORS.blue, width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: COLORS.secondary },
//   statBoxLarge: { backgroundColor: COLORS.accent, padding: 20, alignItems: 'center', borderRadius: 12, marginTop: 20 },
//   bigStat: { color: COLORS.blue, fontSize: 40, fontWeight: 'bold' },
//   bigStatLbl: { color: COLORS.textDark, fontSize: 12, letterSpacing: 2 },
//   questPaperDark: { backgroundColor: COLORS.secondary, margin: 20, padding: 20, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent },
//   questTitleDark: { color: COLORS.text, fontSize: 20, fontWeight: 'bold', textAlign: 'center' },
//   difficulty: { color: COLORS.gold, textAlign: 'center', fontSize: 12, marginBottom: 10 },
//   objTitleDark: { color: COLORS.blue, fontWeight: 'bold', marginTop: 10 },
//   objRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
//   objTextDark: { color: COLORS.text },
//   objValDark: { color: COLORS.text, fontWeight: 'bold' },
//   divider: { height: 1, backgroundColor: COLORS.accent, marginVertical: 10 },
//   rewardTitleDark: { color: COLORS.text, fontWeight: 'bold' },
//   rewardText: { color: COLORS.blue, fontWeight: 'bold' },
//   acceptBtn: { backgroundColor: COLORS.blue, margin: 20, padding: 15, borderRadius: 8, alignItems: 'center' },
//   acceptBtnText: { color: COLORS.primary, fontWeight: 'bold', letterSpacing: 2 },
//   settingRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: COLORS.accent, alignItems: 'center' },
//   settingText: { color: COLORS.text, fontSize: 16 },
//   alertBox: { backgroundColor: COLORS.secondary, borderRadius: 12, borderWidth: 2, borderColor: COLORS.blue, padding: 20, width: '100%' },
//   alertTitle: { color: COLORS.blue, fontSize: 18, fontWeight: 'bold', textAlign: 'center', letterSpacing: 1 },
//   alertMessage: { color: COLORS.text, textAlign: 'center', marginVertical: 15 },
//   alertButtons: { flexDirection: 'row', justifyContent: 'center', marginTop: 10 },
//   alertButton: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 6, minWidth: 80, alignItems: 'center', marginHorizontal: 5 },
//   alertButtonDefault: { backgroundColor: COLORS.blue },
//   alertButtonDestructive: { backgroundColor: COLORS.danger },
//   alertButtonCancel: { backgroundColor: COLORS.accent },
//   alertButtonText: { color: COLORS.text, fontWeight: 'bold', fontSize: 12 },
//   timerCircle: { width: 120, height: 120, borderRadius: 60, borderWidth: 4, borderColor: COLORS.blue, justifyContent: 'center', alignItems: 'center', marginVertical: 30 },
//   timerText: { fontSize: 40, fontWeight: 'bold', color: COLORS.white },
//   dayBtn: { width: 35, height: 35, borderRadius: 17.5, backgroundColor: COLORS.secondary, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.accent },
//   dayBtnActive: { backgroundColor: COLORS.blue, borderColor: COLORS.glow },
//   dayBtnText: { color: COLORS.textDark, fontSize: 12, fontWeight: 'bold' },
// });














// import React, { useState, useEffect, useRef } from 'react';
// import {
//   View,
//   Text,
//   StyleSheet,
//   TouchableOpacity,
//   ScrollView,
//   TextInput,
//   Animated,
//   Dimensions,
//   StatusBar,
//   Modal,
//   Image,
//   Vibration,
//   Alert,
// } from 'react-native';
// import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
// import AsyncStorage from '@react-native-async-storage/async-storage';
// import { Camera, CameraType } from 'expo-camera';
// import { LineChart } from 'react-native-chart-kit';
// import { Audio } from 'expo-av'; // REVERTED: expo-av is stable and fixes the prototype error
// import * as DocumentPicker from 'expo-document-picker';
// import * as ImagePicker from 'expo-image-picker';
// import Slider from '@react-native-community/slider';
// import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';

// const { width, height } = Dimensions.get('window');

// // --- Type Definitions ---
// type GoalType = 'muscle' | 'weight_loss' | 'speed_strength';

// interface UserData {
//   name: string;
//   level: number;
//   sex: 'male' | 'female';
//   weight: number;
//   height: number;
//   goal: GoalType; 
//   xp: number;
//   totalWorkouts: number;
//   createdAt: string;
//   cameraEnabled: boolean;
//   profileImage?: string;
//   assessmentStats?: { [key: string]: number };
// }

// interface Exercise {
//   name: string;
//   iconName: string;
//   iconLib: 'Ionicons' | 'MaterialCommunityIcons' | 'FontAwesome5';
//   type?: 'reps' | 'duration' | 'distance';
//   custom?: boolean;
// }

// interface ExerciseConfig {
//   [key: string]: Exercise;
// }

// interface Quest {
//   title: string;
//   difficulty: number;
//   exercises: { [key: string]: number };
//   rewards: {
//     xp: number;
//     title: string;
//   };
//   customExercises?: ExerciseConfig;
// }

// interface TrainingResult {
//   [key: string]: number;
// }

// interface TrainingHistory {
//   date: string;
//   quest: Quest;
//   results: TrainingResult;
//   xpGained: number;
// }

// interface MusicTrack {
//   id: string;
//   title: string;
//   path: any; // require() or uri string
//   isLocal: boolean;
//   isFavorite: boolean;
//   artwork?: string;
// }

// interface CustomProgram {
//   id: string;
//   name: string;
//   exercises: { [key: string]: number };
//   customExercises?: ExerciseConfig;
//   createdAt: string;
// }

// interface AlertButton {
//   text: string;
//   onPress?: () => void;
//   style?: 'default' | 'cancel' | 'destructive';
// }

// interface CustomAlertState {
//   visible: boolean;
//   title: string;
//   message: string;
//   buttons: AlertButton[];
// }

// type PlaybackMode = 'loop_all' | 'play_all' | 'loop_one' | 'play_one';

// // --- Theme ---
// const COLORS = {
//   primary: '#050714',     
//   secondary: '#0F172A',   
//   accent: '#1E293B',      
//   highlight: '#2563EB',   
//   blue: '#3B82F6',        
//   lightBlue: '#60A5FA',
//   purple: '#7C3AED',      
//   danger: '#EF4444',
//   success: '#10B981',
//   text: '#F8FAFC',
//   textDark: '#94A3B8',
//   glow: '#0EA5E9',
//   gold: '#F59E0B',
//   white: '#FFFFFF',
// };

// // --- Initial Data ---
// const EXERCISES: ExerciseConfig = {
//   // Standard
//   squats: { name: 'Squats', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   pushups: { name: 'Push-ups', iconName: 'human-handsup', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   situps: { name: 'Sit-ups', iconName: 'dumbbell', iconLib: 'FontAwesome5', type: 'reps' },
//   pullups: { name: 'Pull-ups', iconName: 'human-male-height', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   bicepCurls: { name: 'Bicep Curls', iconName: 'arm-flex', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   lunges: { name: 'Lunges', iconName: 'run', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   plank: { name: 'Plank (sec)', iconName: 'timer', iconLib: 'Ionicons', type: 'duration' },
//   running: { name: 'Running (km)', iconName: 'run-fast', iconLib: 'MaterialCommunityIcons', type: 'distance' },
  
//   // Dynamic / Speed & Strength
//   clapPushups: { name: 'Clap Push-ups', iconName: 'flash', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   jumpSquats: { name: 'Jump Squats', iconName: 'arrow-up-bold-circle', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   burpees: { name: 'Burpees', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
// };

// // --- Sound System ---
// const SYSTEM_SOUND = require('../assets/audio/solo_leveling_system.mp3'); 
// const DEFAULT_OST = require('../assets/audio/ost.mp3');

// // --- Helper Components ---
// const SoloIcon = ({ name, lib, size = 24, color = COLORS.text }: { name: string, lib: string, size?: number, color?: string }) => {
//   if (lib === 'Ionicons') return <Ionicons name={name as any} size={size} color={color} />;
//   if (lib === 'MaterialCommunityIcons') return <MaterialCommunityIcons name={name as any} size={size} color={color} />;
//   if (lib === 'FontAwesome5') return <FontAwesome5 name={name as any} size={size} color={color} />;
//   return null;
// };

// // Custom Alert Component
// const CustomAlert = ({ visible, title, message, buttons, onClose }: { visible: boolean, title: string, message: string, buttons: AlertButton[], onClose: () => void }) => {
//   if (!visible) return null;
//   return (
//     <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
//       <View style={styles.modalOverlay}>
//         <View style={styles.alertBox}>
//           <Text style={styles.alertTitle}>{title}</Text>
//           <View style={styles.divider} />
//           <Text style={styles.alertMessage}>{message}</Text>
//           <View style={styles.alertButtons}>
//             {buttons.map((btn, index) => (
//               <TouchableOpacity
//                 key={index}
//                 style={[
//                   styles.alertButton,
//                   btn.style === 'destructive' ? styles.alertButtonDestructive : 
//                   btn.style === 'cancel' ? styles.alertButtonCancel : styles.alertButtonDefault
//                 ]}
//                 onPress={() => {
//                   if (btn.onPress) btn.onPress();
//                   onClose();
//                 }}
//               >
//                 <Text style={styles.alertButtonText}>{btn.text}</Text>
//               </TouchableOpacity>
//             ))}
//           </View>
//         </View>
//       </View>
//     </Modal>
//   );
// };

// // --- Main App ---
// export default function SoloLevelingFitnessTracker(): JSX.Element {
//   // Global State
//   const [screen, setScreenState] = useState<string>('loading');
//   const [userData, setUserData] = useState<UserData | null>(null);
  
//   // Alert State
//   const [alertState, setAlertState] = useState<CustomAlertState>({
//     visible: false, title: '', message: '', buttons: [],
//   });

//   // Music Player State (Using expo-av to fix crash)
//   const [playlist, setPlaylist] = useState<MusicTrack[]>([]);
//   const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
//   const [sound, setSound] = useState<Audio.Sound | null>(null); // Reverted to Sound object
//   const [isPlaying, setIsPlaying] = useState(false);
//   const [musicLoading, setMusicLoading] = useState(false); 
//   const [position, setPosition] = useState(0);
//   const [duration, setDuration] = useState(0);
//   const [isMuted, setIsMuted] = useState(false);
//   const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('loop_all');
  
//   const playlistRef = useRef<MusicTrack[]>([]);
//   const currentTrackRef = useRef<MusicTrack | null>(null);
//   const playbackModeRef = useRef<PlaybackMode>('loop_all');

//   useEffect(() => { playlistRef.current = playlist; }, [playlist]);
//   useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
//   useEffect(() => { playbackModeRef.current = playbackMode; }, [playbackMode]);

//   // System Sound State
//   const [systemSoundObj, setSystemSoundObj] = useState<Audio.Sound | null>(null);

//   // Training State
//   const [currentQuest, setCurrentQuest] = useState<Quest | null>(null);
//   const [isTraining, setIsTraining] = useState<boolean>(false);

//   // --- Audio System Logic ---

//   const playSystemSound = async () => {
//     try {
//       if (systemSoundObj) {
//         await systemSoundObj.unloadAsync();
//       }
//       if (sound && isPlaying) {
//         await sound.setVolumeAsync(0.1); 
//       }

//       const { sound: newSysSound } = await Audio.Sound.createAsync(SYSTEM_SOUND);
//       setSystemSoundObj(newSysSound);
//       await newSysSound.playAsync();

//       newSysSound.setOnPlaybackStatusUpdate(async (status) => {
//         if (status.isLoaded && status.didJustFinish) {
//           await newSysSound.unloadAsync();
//           setSystemSoundObj(null);
//           if (sound && isPlaying) {
//             await sound.setVolumeAsync(1.0);
//           }
//         }
//       });
//     } catch (error) {
//       console.log('System sound error', error);
//     }
//   };

//   const navigateTo = (newScreen: string) => {
//     if (newScreen !== screen) {
//       playSystemSound();
//       setScreenState(newScreen);
//     }
//   };

//   const showAlert = (title: string, message: string, buttons: AlertButton[] = [{ text: 'OK' }]) => {
//     setAlertState({ visible: true, title, message, buttons });
//   };

//   const closeAlert = () => {
//     setAlertState(prev => ({ ...prev, visible: false }));
//   };

//   useEffect(() => {
//     async function init() {
//       await Audio.setAudioModeAsync({
//         allowsRecordingIOS: false,
//         playsInSilentModeIOS: true,
//         staysActiveInBackground: true,
//         shouldDuckAndroid: true,
//       });

//       try {
//         const stored = await AsyncStorage.getItem('musicPlaylist');
//         const defaultTrack: MusicTrack = {
//           id: 'default_ost',
//           title: 'System Soundtrack (Default)',
//           path: DEFAULT_OST,
//           isLocal: true,
//           isFavorite: true,
//         };
//         let tracks: MusicTrack[] = [defaultTrack];
//         if (stored) {
//           const parsed = JSON.parse(stored);
//           const userTracks = parsed.filter((t: MusicTrack) => t.id !== 'default_ost');
//           tracks = [...tracks, ...userTracks];
//         }
//         setPlaylist(tracks);
//       } catch (e) {
//         console.error("Audio Init Error", e);
//       }

//       playSystemSound();
      
//       const data = await AsyncStorage.getItem('userData');
//       if (data) {
//         setUserData(JSON.parse(data));
//         setScreenState('dashboard');
//       } else {
//         setScreenState('setup');
//       }
//     }
//     init();

//     return () => {
//       if (sound) sound.unloadAsync();
//       if (systemSoundObj) systemSoundObj.unloadAsync();
//     };
//   }, []);

//   // UI Updater for slider
//   useEffect(() => {
//     let interval: NodeJS.Timeout;
//     if (sound && isPlaying) {
//       interval = setInterval(async () => {
//         try {
//           const status = await sound.getStatusAsync();
//           if (status.isLoaded) {
//             setPosition(status.positionMillis / 1000);
//             setDuration(status.durationMillis ? status.durationMillis / 1000 : 1);
//           }
//         } catch (e) {}
//       }, 1000);
//     }
//     return () => clearInterval(interval);
//   }, [sound, isPlaying]);

//   const handleAutoNext = async (currentSound: Audio.Sound) => {
//     const list = playlistRef.current;
//     const curr = currentTrackRef.current;
//     const mode = playbackModeRef.current;

//     if (!curr || list.length === 0) return;

//     if (mode === 'loop_one') {
//       await currentSound.replayAsync();
//     } 
//     else if (mode === 'play_one') {
//       setIsPlaying(false); setPosition(0);
//       await currentSound.stopAsync();
//       await currentSound.setPositionAsync(0);
//     } 
//     else if (mode === 'play_all') {
//       const idx = list.findIndex(t => t.id === curr.id);
//       if (idx !== -1 && idx < list.length - 1) {
//         playTrack(list[idx + 1]);
//       } else {
//         setIsPlaying(false); setPosition(0);
//         await currentSound.stopAsync();
//         await currentSound.setPositionAsync(0);
//       }
//     } 
//     else if (mode === 'loop_all') {
//       const idx = list.findIndex(t => t.id === curr.id);
//       const nextIdx = (idx + 1) % list.length;
//       playTrack(list[nextIdx]);
//     }
//   };

//   const saveUserData = async (data: UserData) => {
//     await AsyncStorage.setItem('userData', JSON.stringify(data));
//     setUserData(data);
//   };

//   // --- Music Controls ---
//   const playTrack = async (track: MusicTrack) => {
//     if (musicLoading) return;
    
//     if (currentTrack?.id === track.id && sound) {
//         const status = await sound.getStatusAsync();
//         if(status.isLoaded && !status.isPlaying) {
//              await sound.playAsync();
//              setIsPlaying(true);
//              return;
//         }
//     }

//     try {
//       setMusicLoading(true);

//       if (sound) {
//         await sound.unloadAsync();
//         setSound(null);
//       }

//       const source = track.isLocal ? track.path : { uri: track.path };
//       const mode = playbackModeRef.current;
//       const shouldLoop = mode === 'loop_one';

//       const { sound: newSound } = await Audio.Sound.createAsync(
//         source, 
//         { shouldPlay: true, isLooping: shouldLoop }
//       );
      
//       newSound.setOnPlaybackStatusUpdate((status) => {
//          if(status.isLoaded) {
//              if (status.didJustFinish && !status.isLooping) {
//                  handleAutoNext(newSound);
//              }
//          }
//       });

//       setSound(newSound);
//       setCurrentTrack(track);
//       setIsPlaying(true);
//       if (isMuted) await newSound.setIsMutedAsync(true);
      
//       setMusicLoading(false);
//     } catch (error) {
//       console.log('Play Error', error);
//       setMusicLoading(false);
//       showAlert('Error', 'Could not play audio track. File might be corrupted or missing.');
//     }
//   };

//   const togglePlayPause = async () => {
//     if (!sound) {
//       if (playlist.length > 0) playTrack(playlist[0]);
//       return;
//     }
//     if (musicLoading) return;

//     if (isPlaying) {
//       await sound.pauseAsync();
//       setIsPlaying(false);
//     } else {
//       await sound.playAsync();
//       setIsPlaying(true);
//     }
//   };

//   const seekTrack = async (value: number) => {
//     if (sound && !musicLoading) {
//       await sound.setPositionAsync(value * 1000);
//       setPosition(value);
//     }
//   };

//   const skipToNext = () => {
//     if (!currentTrack || playlist.length === 0) return;
//     const idx = playlist.findIndex(t => t.id === currentTrack.id);
//     const nextIdx = (idx + 1) % playlist.length;
//     playTrack(playlist[nextIdx]);
//   };

//   const skipToPrev = () => {
//     if (!currentTrack || playlist.length === 0) return;
//     const idx = playlist.findIndex(t => t.id === currentTrack.id);
//     const prevIdx = idx === 0 ? playlist.length - 1 : idx - 1;
//     playTrack(playlist[prevIdx]);
//   };

//   const deleteTrack = async (trackId: string) => {
//     if (trackId === 'default_ost') return;
//     if (currentTrack?.id === trackId) {
//       if (sound) await sound.unloadAsync();
//       setSound(null); setCurrentTrack(null); setIsPlaying(false);
//     }
//     const newList = playlist.filter(t => t.id !== trackId);
//     setPlaylist(newList);
//     AsyncStorage.setItem('musicPlaylist', JSON.stringify(newList));
//   };

//   const addMusicFile = async () => {
//     try {
//       const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
//       if (!result.canceled && result.assets && result.assets.length > 0) {
//         const file = result.assets[0];
//         const newTrack: MusicTrack = {
//           id: Date.now().toString(), 
//           title: file.name, 
//           path: file.uri, 
//           isLocal: false, 
//           isFavorite: false,
//         };
//         const newList = [...playlist, newTrack];
//         setPlaylist(newList);
//         AsyncStorage.setItem('musicPlaylist', JSON.stringify(newList));
//       }
//     } catch (e) { showAlert('Error', 'Failed to pick audio file'); }
//   };

//   // --- Mini Player ---
//   const MiniPlayer = () => {
//     if (!currentTrack) return null;
//     return (
//       <TouchableOpacity activeOpacity={0.9} onPress={() => navigateTo('music')} style={styles.miniPlayerContainer}>
//          <View style={styles.miniProgressContainer}>
//             <View style={[styles.miniProgressFill, { width: `${(position / (duration || 1)) * 100}%` }]} />
//          </View>
//          <View style={styles.miniPlayerContent}>
//             <View style={styles.miniInfo}>
//                {currentTrack.artwork ? (
//                  <Image source={{ uri: currentTrack.artwork }} style={styles.miniArt} />
//                ) : (
//                  <Ionicons name="musical-note" size={20} color={COLORS.blue} style={{marginRight: 10}} />
//                )}
//                <View>
//                  <Text style={styles.miniTitle} numberOfLines={1}>{currentTrack.title}</Text>
//                  <Text style={styles.miniTime}>{formatTime(position)} / {formatTime(duration)}</Text>
//                </View>
//             </View>
//             <View style={styles.miniControls}>
//                <TouchableOpacity onPress={(e) => { e.stopPropagation(); skipToPrev(); }} style={styles.miniCtrlBtn}>
//                  <Ionicons name="play-skip-back" size={20} color={COLORS.text} />
//                </TouchableOpacity>
//                <TouchableOpacity onPress={(e) => { e.stopPropagation(); togglePlayPause(); }} style={styles.miniCtrlBtn}>
//                  <Ionicons name={isPlaying ? "pause" : "play"} size={26} color={COLORS.white} />
//                </TouchableOpacity>
//                <TouchableOpacity onPress={(e) => { e.stopPropagation(); skipToNext(); }} style={styles.miniCtrlBtn}>
//                  <Ionicons name="play-skip-forward" size={20} color={COLORS.text} />
//                </TouchableOpacity>
//             </View>
//          </View>
//       </TouchableOpacity>
//     );
//   };

//   // --- Render Current Screen ---
//   const renderScreen = () => {
//     if (!userData && screen !== 'loading' && screen !== 'setup') return <LoadingScreen />;

//     switch (screen) {
//       case 'loading': return <LoadingScreen />;
//       case 'setup': 
//         return <SetupScreen onComplete={(data) => { 
//             // Don't save yet, go to assessment
//             setUserData(data);
//             setScreenState('assessment');
//         }} />;
//       case 'assessment':
//         return <AssessmentScreen 
//             userData={userData!} 
//             onComplete={(stats, calculatedLevel) => {
//                 const finalData = { ...userData!, level: calculatedLevel, assessmentStats: stats, createdAt: new Date().toISOString() };
//                 saveUserData(finalData);
//                 navigateTo('dashboard');
//             }} 
//         />;
//       case 'dashboard': 
//         return <DashboardScreen 
//           userData={userData!} 
//           onNavigate={navigateTo} 
//           onStartQuest={() => navigateTo('quest')}
//         />;
//       case 'quest': 
//         return <QuestScreen 
//           userData={userData!} 
//           onBack={() => navigateTo('dashboard')}
//           onStartTraining={(quest) => {
//             setCurrentQuest(quest); setIsTraining(true); navigateTo('training');
//           }}
//         />;
//       case 'training':
//         return <TrainingScreen 
//           userData={userData!} 
//           quest={currentQuest!} 
//           onComplete={(results) => { updateProgress(results); navigateTo('dashboard'); }}
//           onBack={() => {
//             showAlert("Abort Mission?", "Stop training?", [{ text: "Cancel", style: "cancel" }, { text: "Quit", style: "destructive", onPress: () => navigateTo('dashboard') }]);
//           }}
//         />;
//       case 'stats': return <StatsScreen userData={userData!} onBack={() => navigateTo('dashboard')} />;
//       case 'music': return <MusicScreen 
//           playlist={playlist} 
//           currentTrack={currentTrack} 
//           isPlaying={isPlaying} 
//           isLoading={musicLoading}
//           position={position}
//           duration={duration}
//           playbackMode={playbackMode}
//           onPlay={playTrack} 
//           onPause={togglePlayPause}
//           onSeek={seekTrack}
//           onNext={skipToNext}
//           onPrev={skipToPrev}
//           onDelete={deleteTrack}
//           onAdd={addMusicFile}
//           onToggleMode={async () => {
//             const modes: PlaybackMode[] = ['loop_all', 'play_all', 'loop_one', 'play_one'];
//             const nextMode = modes[(modes.indexOf(playbackMode) + 1) % modes.length];
//             setPlaybackMode(nextMode);
//             if(sound) await sound.setIsLoopingAsync(nextMode === 'loop_one');
//           }}
//           onBack={() => navigateTo('dashboard')} 
//         />;
//       case 'programs': return <CustomProgramsScreen 
//           userData={userData!} 
//           onBack={() => navigateTo('dashboard')} 
//           onStartProgram={(quest) => {
//             setCurrentQuest(quest); setIsTraining(true); navigateTo('training');
//           }}
//           showAlert={showAlert}
//         />;
//       case 'settings': return <SettingsScreen 
//           userData={userData!} 
//           onSave={(data) => { saveUserData(data); navigateTo('dashboard'); }} 
//           onBack={() => navigateTo('dashboard')} 
//         />;
//       default: return <LoadingScreen />;
//     }
//   };

//   const updateProgress = async (results: TrainingResult) => {
//     try {
//       const history = await AsyncStorage.getItem('trainingHistory');
//       const parsed: TrainingHistory[] = history ? JSON.parse(history) : [];
//       const xpGained = calculateXP(results);
//       const newEntry: TrainingHistory = {
//         date: new Date().toISOString(), quest: currentQuest!, results: results, xpGained: xpGained,
//       };
//       parsed.push(newEntry);
//       await AsyncStorage.setItem('trainingHistory', JSON.stringify(parsed));
//       const newUserData: UserData = {
//         ...userData!, xp: userData!.xp + xpGained, totalWorkouts: (userData!.totalWorkouts || 0) + 1,
//       };
//       const xpNeeded = newUserData.level * 100;
//       if (newUserData.xp >= xpNeeded) {
//         newUserData.level += 1; newUserData.xp = newUserData.xp - xpNeeded; 
//         showAlert('LEVEL UP!', `You have reached Level ${newUserData.level}!`);
//       } else {
//         showAlert('QUEST COMPLETED', `You gained ${xpGained} Experience Points.`);
//       }
//       saveUserData(newUserData);
//     } catch (error) { console.error('Error updating progress:', error); }
//   };

//   const calculateXP = (results: TrainingResult): number => {
//     let xp = 0;
//     Object.values(results).forEach(val => xp += val * 2);
//     return xp;
//   };

//     return (
//     <SafeAreaProvider>
//         <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
//         <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} translucent={false} />
//         <View style={{ flex: 1, paddingBottom: (currentTrack && screen !== 'music') ? 70 : 0 }}>
//             {renderScreen()}
//         </View>
//         {currentTrack && screen !== 'music' && <MiniPlayer />}
//         <CustomAlert 
//             visible={alertState.visible} title={alertState.title} message={alertState.message} 
//             buttons={alertState.buttons} onClose={closeAlert} 
//         />
//         </SafeAreaView>
//     </SafeAreaProvider>
//     );
// }

// // --- Screens ---

// function LoadingScreen() {
//   const spinValue = useRef(new Animated.Value(0)).current;
//   useEffect(() => {
//     Animated.loop(Animated.timing(spinValue, { toValue: 1, duration: 2000, useNativeDriver: true })).start();
//   }, []);
//   const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
//   return (
//     <View style={styles.centerContainer}>
//       <Animated.View style={{ transform: [{ rotate: spin }], marginBottom: 20 }}>
//         <Ionicons name="reload-circle-outline" size={60} color={COLORS.blue} />
//       </Animated.View>
//       <Text style={styles.loadingTitle}>SOLO LEVELING</Text>
//       <Text style={styles.loadingSubtitle}>INITIALIZING SYSTEM...</Text>
//     </View>
//   );
// }

// function SetupScreen({ onComplete }: { onComplete: (data: UserData) => void }) {
//   const [formData, setFormData] = useState<any>({ name: '', level: 1, sex: 'male', weight: '', height: '', goal: 'muscle' });
//   const [image, setImage] = useState<string | null>(null);
  
//   const pickImage = async () => {
//     let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5 });
//     if (!result.canceled) setImage(result.assets[0].uri);
//   };
  
//   const handleNext = () => {
//     if (!formData.name) return;
//     onComplete({
//       ...formData, weight: parseFloat(formData.weight) || 70, height: parseFloat(formData.height) || 170,
//       xp: 0, totalWorkouts: 0, createdAt: new Date().toISOString(), cameraEnabled: false, profileImage: image || undefined
//     });
//   };

//   const GoalButton = ({ type, icon, label }: { type: GoalType, icon: string, label: string }) => (
//     <TouchableOpacity 
//         style={[styles.goalBtn, formData.goal === type && styles.goalBtnActive]}
//         onPress={() => setFormData({...formData, goal: type})}
//     >
//         <MaterialCommunityIcons name={icon as any} size={24} color={formData.goal === type ? COLORS.white : COLORS.blue} />
//         <Text style={formData.goal === type ? styles.goalTextActive : styles.goalText}>{label}</Text>
//     </TouchableOpacity>
//   );

//   return (
//     <ScrollView style={styles.screenContainer} contentContainerStyle={{padding: 20}}>
//       <Text style={styles.headerTitle}>PLAYER REGISTRATION</Text>
//       <TouchableOpacity onPress={pickImage} style={styles.avatarPicker}>
//         {image ? ( <Image source={{ uri: image }} style={styles.avatarImage} /> ) : (
//           <View style={styles.avatarPlaceholder}><Ionicons name="camera" size={40} color={COLORS.textDark} /><Text style={styles.avatarText}>ADD PHOTO</Text></View>
//         )}
//       </TouchableOpacity>
//       <View style={styles.formGroup}>
//         <Text style={styles.label}>HUNTER NAME</Text>
//         <TextInput style={styles.input} placeholder="Enter Name" placeholderTextColor={COLORS.textDark} onChangeText={t => setFormData({...formData, name: t})} />
//       </View>
      
//       <View style={styles.formGroup}>
//          <Text style={styles.label}>GOAL / CLASS</Text>
//          <GoalButton type="muscle" icon="arm-flex" label="Muscle & Strength" />
//          <GoalButton type="weight_loss" icon="run-fast" label="Weight Loss" />
//          <GoalButton type="speed_strength" icon="flash" label="Speed & Strength (Assassin)" />
//       </View>

//       <View style={styles.formGroup}>
//          <Text style={styles.label}>GENDER</Text>
//          <View style={styles.genderContainer}>
//             <TouchableOpacity 
//                style={[styles.genderBtn, formData.sex === 'male' && styles.genderBtnActive]} 
//                onPress={() => setFormData({...formData, sex: 'male'})}
//             >
//                <Ionicons name="male" size={20} color={formData.sex === 'male' ? COLORS.white : COLORS.blue} />
//                <Text style={formData.sex === 'male' ? styles.genderTextActive : styles.genderText}>MALE</Text>
//             </TouchableOpacity>
//             <TouchableOpacity 
//                style={[styles.genderBtn, formData.sex === 'female' && styles.genderBtnActive]} 
//                onPress={() => setFormData({...formData, sex: 'female'})}
//             >
//                <Ionicons name="female" size={20} color={formData.sex === 'female' ? COLORS.white : COLORS.blue} />
//                <Text style={formData.sex === 'female' ? styles.genderTextActive : styles.genderText}>FEMALE</Text>
//             </TouchableOpacity>
//          </View>
//       </View>

//       <View style={styles.row}>
//          <View style={[styles.formGroup, {flex:1, marginRight: 10}]}>
//             <Text style={styles.label}>WEIGHT (KG)</Text>
//             <TextInput style={styles.input} keyboardType="numeric" onChangeText={t => setFormData({...formData, weight: t})} />
//          </View>
//          <View style={[styles.formGroup, {flex:1}]}>
//             <Text style={styles.label}>HEIGHT (CM)</Text>
//             <TextInput style={styles.input} keyboardType="numeric" onChangeText={t => setFormData({...formData, height: t})} />
//          </View>
//       </View>
//       <TouchableOpacity style={styles.mainButton} onPress={handleNext}>
//         <Text style={styles.mainButtonText}>PROCEED TO EVALUATION</Text>
//       </TouchableOpacity>
//     </ScrollView>
//   );
// }

// function AssessmentScreen({ userData, onComplete }: { userData: UserData, onComplete: (stats: any, level: number) => void }) {
//     const [step, setStep] = useState<'intro' | 'active' | 'rest' | 'input'>('intro');
//     const [currentExIndex, setCurrentExIndex] = useState(0);
//     const [timer, setTimer] = useState(0);
//     const [reps, setReps] = useState('');
//     const [results, setResults] = useState<{[key:string]: number}>({});

//     const getExercises = () => {
//         if (userData.goal === 'speed_strength') {
//             return ['pushups', 'jumpSquats', 'lunges']; 
//         } else if (userData.goal === 'weight_loss') {
//             return ['squats', 'situps', 'lunges']; 
//         } else {
//             return ['pushups', 'squats', 'situps']; 
//         }
//     };

//     const exercises = getExercises();
//     const currentEx = exercises[currentExIndex];
//     const EX_TIME = 60;
//     const REST_TIME = 15;

//     useEffect(() => {
//         let interval: NodeJS.Timeout;
//         if ((step === 'active' || step === 'rest') && timer > 0) {
//             interval = setInterval(() => {
//                 setTimer(prev => {
//                     if (prev <= 1) {
//                         if (step === 'active') {
//                             Vibration.vibrate();
//                             setStep('input');
//                         } else if (step === 'rest') {
//                             if (currentExIndex < exercises.length - 1) {
//                                 setCurrentExIndex(prevIdx => prevIdx + 1);
//                                 startExercise();
//                             } else {
//                                 finishAssessment();
//                             }
//                         }
//                         return 0;
//                     }
//                     return prev - 1;
//                 });
//             }, 1000);
//         }
//         return () => clearInterval(interval);
//     }, [step, timer]);

//     const startExercise = () => {
//         setTimer(EX_TIME);
//         setStep('active');
//         setReps('');
//     };

//     const handleInput = () => {
//         const count = parseInt(reps) || 0;
//         setResults(prev => ({...prev, [currentEx]: count}));
        
//         if (currentExIndex < exercises.length - 1) {
//             setTimer(REST_TIME);
//             setStep('rest');
//         } else {
//             finishAssessment(count);
//         }
//     };

//     const finishAssessment = (lastReps?: number) => {
//         const finalResults = lastReps ? {...results, [currentEx]: lastReps} : results;
//         let totalReps = 0;
//         Object.values(finalResults).forEach(val => totalReps += val);
//         const calculatedLevel = Math.max(1, Math.floor(totalReps / 40) + 1);
//         onComplete(finalResults, calculatedLevel);
//     };

//     return (
//         <View style={styles.centerContainer}>
//             <Text style={styles.headerTitle}>SYSTEM EVALUATION</Text>
            
//             {step === 'intro' && (
//                 <View style={{padding: 20, alignItems: 'center'}}>
//                     <Text style={styles.questTitleDark}>RANKING TEST</Text>
//                     <Text style={styles.alertMessage}>
//                         You will perform 3 exercises to determine your Hunter Rank. 
//                         {"\n\n"}
//                         1 Minute MAX reps for each.
//                         {"\n"}
//                         15 Seconds rest between sets.
//                     </Text>
//                     {exercises.map(e => (
//                         <View key={e} style={{flexDirection:'row', marginVertical: 5}}>
//                             <SoloIcon name={EXERCISES[e].iconName} lib={EXERCISES[e].iconLib} color={COLORS.blue} />
//                             <Text style={{color: COLORS.text, marginLeft: 10}}>{EXERCISES[e].name}</Text>
//                         </View>
//                     ))}
//                     <TouchableOpacity style={styles.mainButton} onPress={startExercise}>
//                         <Text style={styles.mainButtonText}>START TEST</Text>
//                     </TouchableOpacity>
//                 </View>
//             )}

//             {step === 'active' && (
//                 <View style={{alignItems: 'center'}}>
//                     <Text style={styles.loadingSubtitle}>CURRENT EXERCISE</Text>
//                     <Text style={styles.loadingTitle}>{EXERCISES[currentEx].name}</Text>
//                     <View style={styles.timerCircle}>
//                         <Text style={styles.timerText}>{timer}</Text>
//                     </View>
//                     <Text style={styles.label}>DO AS MANY AS YOU CAN</Text>
//                 </View>
//             )}

//             {step === 'input' && (
//                 <View style={{alignItems: 'center', width: '80%'}}>
//                     <Text style={styles.questTitleDark}>TIME'S UP</Text>
//                     <Text style={styles.label}>ENTER REPS COMPLETED:</Text>
//                     <TextInput 
//                         style={[styles.input, {textAlign: 'center', fontSize: 24, width: 100}]}
//                         keyboardType="numeric"
//                         value={reps}
//                         onChangeText={setReps}
//                         autoFocus
//                     />
//                     <TouchableOpacity style={styles.mainButton} onPress={handleInput}>
//                         <Text style={styles.mainButtonText}>CONFIRM</Text>
//                     </TouchableOpacity>
//                 </View>
//             )}

//             {step === 'rest' && (
//                 <View style={{alignItems: 'center'}}>
//                     <Text style={styles.loadingTitle}>REST</Text>
//                     <Text style={styles.timerText}>{timer}</Text>
//                     <Text style={styles.loadingSubtitle}>NEXT: {EXERCISES[exercises[currentExIndex + 1]]?.name}</Text>
//                 </View>
//             )}
//         </View>
//     );
// }

// function DashboardScreen({ userData, onNavigate, onStartQuest }: any) {
//   if (!userData) return null;

//   const xpPercent = (userData.xp / (userData.level * 100)) * 100;
//   return (
//     <ScrollView style={styles.screenContainer}>
//       <View style={styles.dashboardHeader}>
//         <View style={styles.profileRow}>
//           <Image source={userData.profileImage ? { uri: userData.profileImage } : { uri: 'https://via.placeholder.com/150' }} style={styles.profileImageSmall} />
//           <View>
//             <Text style={styles.playerName}>{userData.name}</Text>
//             <Text style={styles.playerRank}>LEVEL {userData.level}</Text>
//             <Text style={{color: COLORS.gold, fontSize: 10, letterSpacing: 1}}>CLASS: {userData.goal.replace('_', ' ').toUpperCase()}</Text>
//           </View>
//         </View>
//       </View>
//       <View style={styles.systemWindow}>
//         <Text style={styles.systemHeader}>STATUS</Text>
//         <View style={styles.xpBarContainer}>
//           <View style={[styles.xpBarFill, { width: `${xpPercent}%` }]} />
//         </View>
//         <Text style={styles.xpText}>{userData.xp} / {userData.level * 100} XP</Text>
//         <View style={styles.statGrid}>
//           <View style={styles.statItem}><Ionicons name="barbell-outline" size={20} color={COLORS.blue} /><Text style={styles.statVal}>{userData.totalWorkouts}</Text><Text style={styles.statLbl}>Raids</Text></View>
//           <View style={styles.statItem}><MaterialCommunityIcons name="fire" size={20} color={COLORS.danger} /><Text style={styles.statVal}>{userData.level}</Text><Text style={styles.statLbl}>Rank</Text></View>
//         </View>
//       </View>
//       <View style={styles.menuGrid}>
//         <TouchableOpacity style={styles.menuCardLarge} onPress={onStartQuest}>
//            <MaterialCommunityIcons name="sword-cross" size={40} color={COLORS.gold} />
//            <Text style={styles.menuTitle}>DAILY QUEST</Text>
//            <Text style={styles.menuSub}>Available</Text>
//         </TouchableOpacity>
//         <View style={styles.menuRow}>
//            <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('programs')}><Ionicons name="list" size={24} color={COLORS.blue} /><Text style={styles.menuTitleSmall}>Programs</Text></TouchableOpacity>
//            <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('stats')}><Ionicons name="stats-chart" size={24} color={COLORS.success} /><Text style={styles.menuTitleSmall}>Stats</Text></TouchableOpacity>
//         </View>
//         <View style={styles.menuRow}>
//            <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('music')}><Ionicons name="musical-notes" size={24} color={COLORS.purple} /><Text style={styles.menuTitleSmall}>Music</Text></TouchableOpacity>
//            <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('settings')}><Ionicons name="settings" size={24} color={COLORS.textDark} /><Text style={styles.menuTitleSmall}>Settings</Text></TouchableOpacity>
//         </View>
//       </View>
//     </ScrollView>
//   );
// }

// function MusicScreen({ 
//   playlist, currentTrack, isPlaying, isLoading, position, duration, playbackMode,
//   onPlay, onPause, onSeek, onNext, onPrev, onDelete, onAdd, onToggleMode, onBack 
// }: any) {
  
//   const [searchQuery, setSearchQuery] = useState('');

//   const getModeIcon = () => {
//     switch(playbackMode) {
//       case 'loop_one': return 'repeat-once';
//       case 'loop_all': return 'repeat';
//       case 'play_one': return 'numeric-1-box-outline';
//       case 'play_all': return 'playlist-play';
//       default: return 'repeat';
//     }
//   };

//   const filteredPlaylist = playlist.filter((track: MusicTrack) => 
//       track.title.toLowerCase().includes(searchQuery.toLowerCase())
//   );

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}>
//         <TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity>
//         <Text style={styles.headerTitle}>MUSIC PLAYER</Text>
//         <TouchableOpacity onPress={onToggleMode} style={styles.modeBtnHeader}>
//            <MaterialCommunityIcons name={getModeIcon()} size={20} color={COLORS.blue} />
//         </TouchableOpacity>
//       </View>
//       <View style={styles.playerMain}>
//         {currentTrack && currentTrack.artwork ? (
//            <Image source={{uri: currentTrack.artwork}} style={styles.albumArt} />
//         ) : (
//            <View style={styles.albumArtPlaceholder}><Ionicons name="musical-note" size={80} color={COLORS.highlight} /></View>
//         )}
//         <Text style={styles.nowPlayingTitle} numberOfLines={1}>{currentTrack ? currentTrack.title : 'Select a Track'}</Text>
//         <View style={styles.seekContainer}>
//           <Text style={styles.timeText}>{formatTime(position)}</Text>
//           <Slider
//             style={{flex: 1, marginHorizontal: 10}} minimumValue={0} maximumValue={duration > 0 ? duration : 1}
//             value={position} minimumTrackTintColor={COLORS.highlight} maximumTrackTintColor={COLORS.accent} thumbTintColor={COLORS.blue}
//             onSlidingComplete={onSeek}
//           />
//           <Text style={styles.timeText}>{formatTime(duration)}</Text>
//         </View>
//         <View style={styles.playerControlsMain}>
//            <TouchableOpacity onPress={onPrev} style={styles.ctrlBtn}><Ionicons name="play-skip-back" size={30} color={COLORS.text} /></TouchableOpacity>
//            <TouchableOpacity onPress={onPause} style={styles.playButtonLarge}>
//              {isLoading ? (
//                <View style={{width: 30, height: 30, borderWidth: 3, borderRadius: 15, borderColor: COLORS.primary, borderTopColor: COLORS.blue}} />
//              ) : (
//                <Ionicons name={isPlaying ? "pause" : "play"} size={40} color={COLORS.primary} />
//              )}
//            </TouchableOpacity>
//            <TouchableOpacity onPress={onNext} style={styles.ctrlBtn}><Ionicons name="play-skip-forward" size={30} color={COLORS.text} /></TouchableOpacity>
//         </View>
//       </View>
//       <View style={styles.playlistHeader}>
//         <Text style={styles.sectionTitle}>PLAYLIST</Text>
//         <TouchableOpacity onPress={onAdd} style={styles.addBtn}><Ionicons name="add" size={20} color={COLORS.primary} /></TouchableOpacity>
//       </View>
      
//       <View style={{paddingHorizontal: 20, marginBottom: 5}}>
//           <View style={styles.searchContainer}>
//               <Ionicons name="search" size={20} color={COLORS.textDark} />
//               <TextInput 
//                   style={styles.searchInput}
//                   placeholder="Search tracks..."
//                   placeholderTextColor={COLORS.textDark}
//                   value={searchQuery}
//                   onChangeText={setSearchQuery}
//               />
//           </View>
//       </View>

//       <ScrollView style={styles.playlistContainer}>
//         {filteredPlaylist.map((track: MusicTrack) => (
//           <View key={track.id} style={[styles.trackRow, currentTrack?.id === track.id && styles.trackActive]}>
//             <TouchableOpacity style={styles.trackInfoArea} onPress={() => onPlay(track)}>
//               <View style={styles.trackIcon}>
//                 <Ionicons name="musical-notes-outline" size={20} color={currentTrack?.id === track.id ? COLORS.white : COLORS.textDark} />
//               </View>
//               <Text 
//                 style={[styles.trackName, currentTrack?.id === track.id && styles.trackNameActive]} 
//                 numberOfLines={1}
//               >
//                 {track.title}
//               </Text>
//             </TouchableOpacity>
//             <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(track.id)}>
//                <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
//             </TouchableOpacity>
//           </View>
//         ))}
//       </ScrollView>
//     </View>
//   );
// }

// function TrainingScreen({ userData, quest, onComplete, onBack }: any) {
//   const [counts, setCounts] = useState<TrainingResult>({});
//   const [cameraPerm, setCameraPerm] = useState<boolean | null>(null);
//   const [type, setType] = useState(CameraType.front);
//   const cameraRef = useRef<Camera>(null);
//   useEffect(() => {
//     (async () => {
//       const { status } = await Camera.requestCameraPermissionsAsync();
//       setCameraPerm(status === 'granted');
//     })();
//     const initCounts: any = {};
//     Object.keys(quest.exercises).forEach(k => initCounts[k] = 0);
//     setCounts(initCounts);
//   }, []);
//   const handleIncrement = (ex: string, target: number) => {
//     const current = counts[ex] || 0;
//     if (current < target) setCounts({...counts, [ex]: current + 1});
//   };
//   const isCompleted = (ex: string) => (counts[ex] || 0) >= quest.exercises[ex];
//   const allCompleted = Object.keys(quest.exercises).every(isCompleted);
//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}>
//         <TouchableOpacity onPress={onBack}><Ionicons name="close" size={24} color={COLORS.danger} /></TouchableOpacity>
//         <Text style={styles.headerTitle}>DUNGEON INSTANCE</Text>
//         <TouchableOpacity onPress={() => setType(type === CameraType.back ? CameraType.front : CameraType.back)}>
//           <Ionicons name="camera-reverse" size={24} color={COLORS.blue} />
//         </TouchableOpacity>
//       </View>
//       <View style={styles.cameraContainer}>
//         {cameraPerm && userData.cameraEnabled ? (
//           <Camera style={styles.camera} type={type} ref={cameraRef}>
//              <View style={styles.cameraOverlay}><Text style={styles.detectionText}>SYSTEM: POSE TRACKING ACTIVE</Text><View style={styles.poseBox} /></View>
//           </Camera>
//         ) : (
//            <View style={styles.cameraOff}><Text style={styles.cameraOffText}>CAMERA DISABLED</Text><Text style={styles.cameraOffSub}>Enable in Settings for Auto-Count</Text></View>
//         )}
//       </View>
//       <ScrollView style={styles.exerciseList}>
//         {Object.entries(quest.exercises).map(([key, target]: [string, any]) => {
//           const def = quest.customExercises?.[key] || EXERCISES[key] || { name: key, iconName: 'help', iconLib: 'Ionicons' };
//           const count = counts[key] || 0;
//           return (
//             <View key={key} style={[styles.exerciseCard, isCompleted(key) && styles.exerciseCardDone]}>
//               <View style={styles.exIcon}><SoloIcon name={def.iconName} lib={def.iconLib} size={28} color={COLORS.blue} /></View>
//               <View style={{flex: 1}}><Text style={styles.exName}>{def.name}</Text><View style={styles.progressBarBg}><View style={[styles.progressBarFill, {width: `${Math.min((count/target)*100, 100)}%`}]} /></View></View>
//               <TouchableOpacity style={styles.countBtn} onPress={() => handleIncrement(key, target)} disabled={isCompleted(key)}><Text style={styles.countText}>{count}/{target}</Text></TouchableOpacity>
//             </View>
//           );
//         })}
//       </ScrollView>
//       {allCompleted && (
//         <TouchableOpacity style={styles.completeBtn} onPress={() => onComplete(counts)}><Text style={styles.completeBtnText}>COMPLETE DUNGEON</Text></TouchableOpacity>
//       )}
//     </View>
//   );
// }

// function CustomProgramsScreen({ userData, onBack, onStartProgram, showAlert }: any) {
//   const [programs, setPrograms] = useState<CustomProgram[]>([]);
//   const [modalVisible, setModalVisible] = useState(false);
//   const [newProgName, setNewProgName] = useState('');
//   const [editingId, setEditingId] = useState<string | null>(null);
  
//   // Exercises Logic
//   const [selectedEx, setSelectedEx] = useState<{[key:string]: number}>({});
//   const [customList, setCustomList] = useState<Array<{id: string, name: string, reps: number}>>([]);
//   const [customExName, setCustomExName] = useState('');
//   const [customExCount, setCustomExCount] = useState('10');
  
//   useEffect(() => { AsyncStorage.getItem('customPrograms').then(r => r && setPrograms(JSON.parse(r))); }, []);

//   const toggleExercise = (key: string) => {
//     const next = {...selectedEx};
//     if (next[key]) delete next[key]; else next[key] = 10; 
//     setSelectedEx(next);
//   };

//   const updateReps = (key: string, val: string) => {
//     const next = {...selectedEx, [key]: parseInt(val) || 0};
//     setSelectedEx(next);
//   };

//   const addCustomExercise = () => {
//     if (!customExName) { showAlert("Error", "Enter name"); return; }
//     const newEx = {
//       id: `cust_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
//       name: customExName,
//       reps: parseInt(customExCount) || 10
//     };
//     setCustomList([...customList, newEx]);
//     setCustomExName('');
//     setCustomExCount('10');
//   };

//   const removeCustomExercise = (id: string) => {
//     setCustomList(customList.filter(item => item.id !== id));
//   };

//   const openCreateModal = () => {
//     setNewProgName('');
//     setEditingId(null);
//     setSelectedEx({});
//     setCustomList([]);
//     setModalVisible(true);
//   };

//   const openEditModal = (prog: CustomProgram) => {
//     setNewProgName(prog.name);
//     setEditingId(prog.id);
//     const stdEx: {[key:string]: number} = {};
//     const cList: Array<{id: string, name: string, reps: number}> = [];

//     Object.entries(prog.exercises).forEach(([key, reps]) => {
//         if(EXERCISES[key]) {
//             stdEx[key] = reps;
//         } else if (prog.customExercises && prog.customExercises[key]) {
//             cList.push({
//                 id: key,
//                 name: prog.customExercises[key].name,
//                 reps: reps
//             });
//         }
//     });

//     setSelectedEx(stdEx);
//     setCustomList(cList);
//     setModalVisible(true);
//   };

//   const saveProgram = () => {
//     if (!newProgName) { showAlert("Error", "Name required"); return; }
    
//     let customDefs: ExerciseConfig = {};
//     let finalExercises = { ...selectedEx };

//     customList.forEach(item => {
//       customDefs[item.id] = { name: item.name, iconName: 'star', iconLib: 'Ionicons', custom: true, type: 'reps' };
//       finalExercises[item.id] = item.reps;
//     });

//     const newProg: CustomProgram = {
//       id: editingId ? editingId : Date.now().toString(), 
//       name: newProgName, 
//       exercises: finalExercises,
//       customExercises: customDefs, 
//       createdAt: new Date().toISOString()
//     };
    
//     let updated;
//     if(editingId) updated = programs.map(p => p.id === editingId ? newProg : p);
//     else updated = [...programs, newProg];

//     setPrograms(updated);
//     AsyncStorage.setItem('customPrograms', JSON.stringify(updated));
//     setModalVisible(false);
//   };

//   const deleteProgram = (id: string) => {
//     const updated = programs.filter(p => p.id !== id);
//     setPrograms(updated);
//     AsyncStorage.setItem('customPrograms', JSON.stringify(updated));
//   };

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}>
//         <TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity>
//         <Text style={styles.headerTitle}>CUSTOM PROGRAMS</Text>
//         <TouchableOpacity onPress={openCreateModal}><Ionicons name="add-circle" size={30} color={COLORS.blue} /></TouchableOpacity>
//       </View>
//       <ScrollView style={{padding: 20}}>
//         {programs.map(p => (
//            <View key={p.id} style={styles.programCard}>
//               <View style={{flex: 1}}>
//                 <Text style={styles.progTitle}>{p.name}</Text>
//                 <Text style={styles.progSub}>{Object.keys(p.exercises).length} Exercises</Text>
//               </View>
//               <TouchableOpacity style={styles.startBtnSmall} onPress={() => onStartProgram({
//                    title: p.name, difficulty: 1, exercises: p.exercises, rewards: { xp: 50, title: 'Custom' }, customExercises: p.customExercises
//                 })}>
//                  <Text style={styles.btnTextSmall}>START</Text>
//               </TouchableOpacity>
//               <TouchableOpacity style={styles.editProgBtn} onPress={() => openEditModal(p)}>
//                  <Ionicons name="create-outline" size={20} color={COLORS.white} />
//               </TouchableOpacity>
//               <TouchableOpacity style={styles.deleteProgBtn} onPress={() => deleteProgram(p.id)}>
//                  <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
//               </TouchableOpacity>
//            </View>
//         ))}
//       </ScrollView>
//       <Modal visible={modalVisible} animationType="slide" transparent>
//         <View style={styles.modalOverlay}>
//            <View style={styles.createModal}>
//               <Text style={styles.modalTitle}>{editingId ? 'EDIT PROGRAM' : 'NEW PROGRAM'}</Text>
//               <TextInput style={styles.input} placeholder="Program Name" placeholderTextColor={COLORS.textDark} value={newProgName} onChangeText={setNewProgName} />
//               <ScrollView style={{height: 250, marginVertical: 10}}>
//                  {/* Standard Exercises */}
//                  {Object.entries(EXERCISES).map(([k, v]) => (
//                     <View key={k} style={styles.selectRowContainer}>
//                         <Text style={styles.rowLabel}>{v.name}</Text>
//                         <View style={{flexDirection:'row', alignItems:'center'}}>
//                           {selectedEx[k] ? (
//                                 <TextInput style={styles.repsInput} keyboardType="numeric" value={String(selectedEx[k])} onChangeText={(val) => updateReps(k, val)} />
//                           ) : null}
//                           <TouchableOpacity style={[styles.checkboxBtn, selectedEx[k] ? styles.checkboxActive : {}]} onPress={() => toggleExercise(k)}>
//                              <Ionicons name={selectedEx[k] ? "remove" : "add"} size={20} color={selectedEx[k] ? COLORS.white : COLORS.blue} />
//                           </TouchableOpacity>
//                         </View>
//                     </View>
//                  ))}
                 
//                  {/* Custom Exercises List */}
//                  {customList.length > 0 && <Text style={[styles.label, {marginTop: 15}]}>Added Custom:</Text>}
//                  {customList.map((item) => (
//                     <View key={item.id} style={styles.selectRowContainer}>
//                         <View style={{flex:1}}><Text style={styles.rowLabel}>{item.name} ({item.reps} reps)</Text></View>
//                         <TouchableOpacity style={styles.deleteBtn} onPress={() => removeCustomExercise(item.id)}>
//                              <Ionicons name="trash-outline" size={20} color={COLORS.danger} />
//                         </TouchableOpacity>
//                     </View>
//                  ))}
//               </ScrollView>
              
//               <View style={{borderTopWidth: 1, borderTopColor: COLORS.accent, paddingTop: 10}}>
//                  <Text style={styles.label}>Add Custom Exercise:</Text>
//                  <View style={styles.row}>
//                     <TextInput style={[styles.input, {flex: 2, marginRight: 5}]} placeholder="Name" placeholderTextColor={COLORS.textDark} value={customExName} onChangeText={setCustomExName} />
//                     <TextInput style={[styles.input, {flex: 1, marginRight: 5}]} keyboardType="numeric" placeholder="Reps" placeholderTextColor={COLORS.textDark} value={customExCount} onChangeText={setCustomExCount} />
//                     <TouchableOpacity style={styles.addCustomBtn} onPress={addCustomExercise}>
//                       <Ionicons name="add" size={24} color={COLORS.white} />
//                     </TouchableOpacity>
//                  </View>
//               </View>

//               <View style={[styles.row, {marginTop: 10}]}>
//                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}><Text style={styles.btnText}>CANCEL</Text></TouchableOpacity>
//                  <TouchableOpacity style={styles.saveBtn} onPress={saveProgram}><Text style={styles.btnText}>SAVE</Text></TouchableOpacity>
//               </View>
//            </View>
//         </View>
//       </Modal>
//     </View>
//   );
// }

// function StatsScreen({ userData, onBack }: any) {
//   const [data, setData] = useState<number[]>([0]);
//   useEffect(() => {
//      AsyncStorage.getItem('trainingHistory').then(h => {
//         if(h) {
//            const history = JSON.parse(h);
//            const xp = history.map((i: any) => i.xpGained);
//            if(xp.length > 0) setData(xp.slice(-6));
//         }
//      });
//   }, []);
//   return (
//     <ScrollView style={styles.screenContainer}>
//        <View style={styles.header}>
//         <TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity>
//         <Text style={styles.headerTitle}>STATISTICS</Text>
//         <View style={{width: 24}} />
//       </View>
//       <View style={{padding: 20}}>
//         <Text style={styles.sectionTitle}>XP GAIN HISTORY</Text>
//         <LineChart
//           data={{ labels: ["1", "2", "3", "4", "5", "6"], datasets: [{ data: data }] }}
//           width={width - 40} height={220} yAxisLabel="" yAxisSuffix=" XP"
//           chartConfig={{
//             backgroundColor: COLORS.secondary, backgroundGradientFrom: COLORS.secondary, backgroundGradientTo: COLORS.accent,
//             decimalPlaces: 0, color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`, labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
//             style: { borderRadius: 16 }, propsForDots: { r: "6", strokeWidth: "2", stroke: COLORS.glow }
//           }}
//           style={{ marginVertical: 8, borderRadius: 16 }}
//         />
//         <View style={styles.statBoxLarge}>
//            <Text style={styles.bigStat}>{userData.totalWorkouts}</Text>
//            <Text style={styles.bigStatLbl}>TOTAL DUNGEONS CLEARED</Text>
//         </View>
//       </View>
//     </ScrollView>
//   );
// }

// function QuestScreen({ userData, onBack, onStartTraining }: any) {
   
//    // Generate Quest based on Goal and Level
//    const getDailyQuest = (): Quest => {
//       const level = userData.level;
//       let exercises: {[key:string]: number} = {};
//       let title = "DAILY QUEST";
//       let rewardXP = 100 * level;

//       if (userData.goal === 'speed_strength') {
//           title = "ASSASSIN TRAINING";
//           exercises = {
//              clapPushups: Math.ceil(level * 5),
//              jumpSquats: Math.ceil(level * 10),
//              situps: Math.ceil(level * 10),
//              running: Math.min(1 + (level * 0.2), 5) 
//           };
//       } else if (userData.goal === 'weight_loss') {
//           title = "ENDURANCE TRIAL";
//           exercises = {
//              squats: level * 15,
//              situps: level * 15,
//              burpees: level * 5,
//              running: Math.min(2 + (level * 0.5), 10)
//           };
//       } else {
//           title = "STRENGTH TRAINING";
//           exercises = {
//              pushups: level * 10,
//              squats: level * 10,
//              situps: level * 10,
//              pullups: Math.ceil(level * 2)
//           };
//       }

//       return {
//          title,
//          difficulty: Math.floor(level / 5) + 1,
//          exercises,
//          rewards: { xp: rewardXP, title: 'Hunter' }
//       };
//    };

//    const dailyQuest = getDailyQuest();

//    return (
//       <View style={styles.screenContainer}>
//          <View style={styles.header}>
//             <TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity>
//             <Text style={styles.headerTitle}>QUEST INFO</Text>
//             <View style={{width: 24}} />
//          </View>
//          <View style={styles.questPaperDark}>
//             <Text style={styles.questTitleDark}>{dailyQuest.title}</Text>
//             <Text style={styles.difficulty}>Rank: {'★'.repeat(dailyQuest.difficulty)}</Text>
//             <View style={styles.divider} />
//             <Text style={styles.objTitleDark}>OBJECTIVES:</Text>
//             {Object.entries(dailyQuest.exercises).map(([k, v]) => (
//                <View key={k} style={styles.objRow}>
//                   <View style={{flexDirection: 'row', alignItems: 'center'}}>
//                      <View style={{width: 6, height: 6, backgroundColor: COLORS.blue, marginRight: 8}} />
//                      <Text style={styles.objTextDark}>{EXERCISES[k]?.name || k}</Text>
//                   </View>
//                   <Text style={styles.objValDark}>{v} {EXERCISES[k]?.type === 'distance' ? 'km' : ''}</Text>
//                </View>
//             ))}
//             <View style={styles.divider} />
//             <Text style={styles.rewardTitleDark}>REWARDS:</Text>
//             <Text style={styles.rewardText}>+ {dailyQuest.rewards.xp} XP</Text>
//          </View>
//          <TouchableOpacity style={styles.acceptBtn} onPress={() => onStartTraining(dailyQuest)}>
//             <Text style={styles.acceptBtnText}>ACCEPT QUEST</Text>
//          </TouchableOpacity>
//       </View>
//    );
// }

// function SettingsScreen({ userData, onSave, onBack }: any) {
//   const [camEnabled, setCamEnabled] = useState(userData.cameraEnabled);
//   const [name, setName] = useState(userData.name);
//   const [image, setImage] = useState(userData.profileImage);

//   const pickImage = async () => {
//     let result = await ImagePicker.launchImageLibraryAsync({ 
//         mediaTypes: ImagePicker.MediaTypeOptions.Images, 
//         allowsEditing: true, 
//         aspect: [1, 1], 
//         quality: 0.5 
//     });
//     if (!result.canceled) setImage(result.assets[0].uri);
//   };

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}>
//          <TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity>
//          <Text style={styles.headerTitle}>SYSTEM SETTINGS</Text>
//          <View style={{width:24}} />
//       </View>
//       <ScrollView style={{padding: 20}}>
         
//          <View style={{alignItems: 'center', marginBottom: 20}}>
//             <TouchableOpacity onPress={pickImage}>
//                 <Image source={image ? { uri: image } : { uri: 'https://via.placeholder.com/150' }} style={styles.settingsAvatar} />
//                 <View style={styles.editIconBadge}>
//                     <Ionicons name="camera" size={14} color={COLORS.white} />
//                 </View>
//             </TouchableOpacity>
//             <Text style={[styles.label, {marginTop: 10}]}>EDIT HUNTER NAME</Text>
//             <TextInput 
//                 style={[styles.input, {textAlign: 'center', width: '80%'}]} 
//                 value={name} 
//                 onChangeText={setName} 
//                 placeholder="Hunter Name"
//                 placeholderTextColor={COLORS.textDark}
//             />
//          </View>

//          <View style={styles.divider} />

//          <View style={styles.settingRow}>
//             <Text style={styles.settingText}>Enable Pose Detection (Camera)</Text>
//             <TouchableOpacity onPress={() => setCamEnabled(!camEnabled)}>
//                <Ionicons name={camEnabled ? "checkbox" : "square-outline"} size={28} color={COLORS.blue} />
//             </TouchableOpacity>
//          </View>
         
//          <TouchableOpacity style={styles.settingsSaveBtn} onPress={() => onSave({...userData, cameraEnabled: camEnabled, name: name, profileImage: image})}>
//             <Text style={styles.settingsSaveBtnText}>SAVE CHANGES</Text>
//          </TouchableOpacity>
//       </ScrollView>
//     </View>
//   );
// }

// // --- Helpers ---
// const formatTime = (seconds: number) => {
//   const m = Math.floor(seconds / 60);
//   const s = Math.floor(seconds % 60);
//   return `${m}:${s < 10 ? '0' : ''}${s}`;
// };

// // --- Styles ---
// const styles = StyleSheet.create({
//   container: { flex: 1, backgroundColor: COLORS.primary },
//   screenContainer: { flex: 1, backgroundColor: COLORS.primary },
//   centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.primary },
  
//   loadingTitle: { fontSize: 32, fontWeight: '900', color: COLORS.blue, letterSpacing: 4 },
//   loadingSubtitle: { color: COLORS.textDark, marginTop: 10, letterSpacing: 2 },

//   header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: COLORS.accent },
//   headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', letterSpacing: 1.5 },

//   avatarPicker: { alignSelf: 'center', marginVertical: 20 },
//   avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: COLORS.accent, justifyContent: 'center', alignItems: 'center', borderStyle: 'dashed', borderWidth: 1, borderColor: COLORS.textDark },
//   avatarImage: { width: 100, height: 100, borderRadius: 50 },
//   avatarText: { fontSize: 10, color: COLORS.textDark, marginTop: 5 },
//   formGroup: { marginBottom: 15 },
//   row: { flexDirection: 'row', justifyContent: 'space-between' },
//   label: { color: COLORS.blue, fontSize: 12, marginBottom: 5, fontWeight: 'bold' },
//   input: { backgroundColor: COLORS.secondary, color: COLORS.text, padding: 15, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent },
  
//   genderContainer: { flexDirection: 'row', justifyContent: 'space-between' },
//   genderBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 15, backgroundColor: COLORS.secondary, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent, marginHorizontal: 5 },
//   genderBtnActive: { backgroundColor: COLORS.blue, borderColor: COLORS.glow },
//   genderText: { color: COLORS.blue, fontWeight: 'bold', marginLeft: 8 },
//   genderTextActive: { color: COLORS.white, fontWeight: 'bold', marginLeft: 8 },

//   goalBtn: { flexDirection: 'row', alignItems: 'center', padding: 15, backgroundColor: COLORS.secondary, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent, marginBottom: 8 },
//   goalBtnActive: { backgroundColor: COLORS.blue, borderColor: COLORS.glow },
//   goalText: { color: COLORS.blue, fontWeight: 'bold', marginLeft: 15 },
//   goalTextActive: { color: COLORS.white, fontWeight: 'bold', marginLeft: 15 },

//   mainButton: { backgroundColor: COLORS.blue, padding: 18, borderRadius: 8, alignItems: 'center', marginTop: 20 },
//   mainButtonText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 16, letterSpacing: 2 },

//   dashboardHeader: { padding: 20, paddingTop: 10 },
//   profileRow: { flexDirection: 'row', alignItems: 'center' },
//   profileImageSmall: { width: 60, height: 60, borderRadius: 30, marginRight: 15, borderWidth: 2, borderColor: COLORS.blue },
//   playerName: { color: COLORS.text, fontSize: 22, fontWeight: 'bold' },
//   playerRank: { color: COLORS.glow, fontSize: 12, letterSpacing: 1 },
//   systemWindow: { margin: 20, padding: 20, backgroundColor: COLORS.secondary, borderRadius: 12, borderWidth: 1, borderColor: COLORS.blue },
//   systemHeader: { color: COLORS.text, textAlign: 'center', fontWeight: 'bold', marginBottom: 15 },
//   xpBarContainer: { height: 6, backgroundColor: COLORS.accent, borderRadius: 3, marginBottom: 5 },
//   xpBarFill: { height: '100%', backgroundColor: COLORS.blue, borderRadius: 3 },
//   xpText: { color: COLORS.textDark, fontSize: 10, textAlign: 'right', marginBottom: 15 },
//   statGrid: { flexDirection: 'row', justifyContent: 'space-around' },
//   statItem: { alignItems: 'center' },
//   statVal: { color: COLORS.text, fontSize: 18, fontWeight: 'bold' },
//   statLbl: { color: COLORS.textDark, fontSize: 10 },
//   menuGrid: { padding: 20 },
//   menuCardLarge: { backgroundColor: COLORS.accent, padding: 20, borderRadius: 12, alignItems: 'center', marginBottom: 15, borderWidth: 1, borderColor: COLORS.gold },
//   menuTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', marginTop: 10 },
//   menuSub: { color: COLORS.danger, fontSize: 12 },
//   menuRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 },
//   menuCardSmall: { backgroundColor: COLORS.secondary, width: '48%', padding: 15, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.accent },
//   menuTitleSmall: { color: COLORS.text, marginTop: 5, fontSize: 12 },

//   playerMain: { alignItems: 'center', padding: 20 },
//   albumArtPlaceholder: { width: 140, height: 140, backgroundColor: COLORS.secondary, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 15, borderWidth: 1, borderColor: COLORS.accent },
//   albumArt: { width: 140, height: 140, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: COLORS.accent },
//   nowPlayingTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', marginBottom: 10, textAlign: 'center' },
  
//   seekContainer: { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 15 },
//   timeText: { color: COLORS.textDark, fontSize: 10, width: 35, textAlign: 'center' },
  
//   playerControlsMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', width: '80%' },
//   playButtonLarge: { width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.blue, justifyContent: 'center', alignItems: 'center' },
//   ctrlBtn: { padding: 10 },
  
//   modeBtnHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, padding: 5, borderRadius: 5, borderWidth: 1, borderColor: COLORS.accent },

//   playlistHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginTop: 10 },
//   sectionTitle: { color: COLORS.blue, fontWeight: 'bold' },
//   addBtn: { backgroundColor: COLORS.highlight, padding: 5, borderRadius: 4 },
  
//   searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.secondary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: COLORS.accent, marginTop: 10 },
//   searchInput: { flex: 1, color: COLORS.text, marginLeft: 10, paddingVertical: 5 },

//   playlistContainer: { padding: 20 },
//   trackRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.accent, justifyContent: 'space-between' },
//   trackActive: { backgroundColor: COLORS.accent },
//   trackInfoArea: { flexDirection: 'row', alignItems: 'center', flex: 1 },
//   trackIcon: { width: 30 },
//   thumbArt: { width: 24, height: 24, borderRadius: 4 },
//   trackName: { color: COLORS.textDark, flex: 1, fontSize: 14, marginLeft: 5 },
//   trackNameActive: { color: COLORS.white, fontWeight: 'bold', textShadowColor: COLORS.glow, textShadowRadius: 8 },
//   deleteBtn: { padding: 5 },

//   miniPlayerContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 70, backgroundColor: COLORS.secondary, borderTopWidth: 1, borderTopColor: COLORS.blue, zIndex: 999 },
//   miniProgressContainer: { height: 2, backgroundColor: COLORS.accent, width: '100%' },
//   miniProgressFill: { height: '100%', backgroundColor: COLORS.highlight },
//   miniPlayerContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, flex: 1 },
//   miniInfo: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 10 },
//   miniArt: { width: 40, height: 40, borderRadius: 4, marginRight: 10 },
//   miniTitle: { color: COLORS.white, fontWeight: 'bold', fontSize: 14 },
//   miniTime: { color: COLORS.textDark, fontSize: 10 },
//   miniControls: { flexDirection: 'row', alignItems: 'center' },
//   miniCtrlBtn: { marginHorizontal: 8 },

//   cameraContainer: { height: 250, backgroundColor: '#000', overflow: 'hidden' },
//   camera: { flex: 1 },
//   cameraOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
//   detectionText: { color: COLORS.success, fontSize: 10, position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', padding: 4 },
//   poseBox: { width: 200, height: 300, borderWidth: 2, borderColor: COLORS.glow, opacity: 0.5 },
//   cameraOff: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.secondary },
//   cameraOffText: { color: COLORS.text, fontWeight: 'bold' },
//   cameraOffSub: { color: COLORS.textDark, fontSize: 10 },
//   exerciseList: { flex: 1, padding: 20 },
//   exerciseCard: { flexDirection: 'row', backgroundColor: COLORS.secondary, padding: 15, marginBottom: 10, borderRadius: 8, alignItems: 'center' },
//   exerciseCardDone: { opacity: 0.5, borderColor: COLORS.success, borderWidth: 1 },
//   exIcon: { width: 40 },
//   exName: { color: COLORS.text, fontWeight: 'bold', marginBottom: 5 },
//   progressBarBg: { height: 4, backgroundColor: COLORS.accent, borderRadius: 2, width: '90%' },
//   progressBarFill: { height: '100%', backgroundColor: COLORS.blue, borderRadius: 2 },
//   countBtn: { backgroundColor: COLORS.accent, paddingHorizontal: 15, paddingVertical: 8, borderRadius: 6 },
//   countText: { color: COLORS.blue, fontWeight: 'bold' },
//   completeBtn: { backgroundColor: COLORS.blue, margin: 20, padding: 15, borderRadius: 8, alignItems: 'center' },
//   completeBtnText: { color: COLORS.primary, fontWeight: 'bold', letterSpacing: 2 },

//   programCard: { backgroundColor: COLORS.secondary, padding: 15, borderRadius: 8, marginBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
//   progTitle: { color: COLORS.text, fontSize: 16, fontWeight: 'bold' },
//   progSub: { color: COLORS.textDark, fontSize: 12 },
//   startBtnSmall: { backgroundColor: COLORS.success, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4, marginRight: 10 },
//   editProgBtn: { backgroundColor: COLORS.accent, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 4, marginRight: 10 },
//   deleteProgBtn: { padding: 5 },
//   btnTextSmall: { color: COLORS.primary, fontWeight: 'bold', fontSize: 10 },
  
//   modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
//   createModal: { backgroundColor: COLORS.secondary, padding: 20, borderRadius: 12, borderWidth: 1, borderColor: COLORS.blue },
//   modalTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 15 },
  
//   selectRowContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: COLORS.accent },
//   rowLabel: { color: COLORS.textDark, fontSize: 16 },
//   repsInput: { backgroundColor: COLORS.primary, color: COLORS.white, width: 50, padding: 5, borderRadius: 4, textAlign: 'center', borderWidth: 1, borderColor: COLORS.blue, marginRight: 10 },
//   checkboxBtn: { padding: 5, borderRadius: 4, borderWidth: 1, borderColor: COLORS.blue },
//   checkboxActive: { backgroundColor: COLORS.danger, borderColor: COLORS.danger },
//   addCustomBtn: { backgroundColor: COLORS.blue, padding: 10, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },

//   cancelBtn: { flex: 1, padding: 15, alignItems: 'center', marginRight: 10 },
//   saveBtn: { flex: 1, backgroundColor: COLORS.blue, padding: 15, alignItems: 'center', borderRadius: 6 },
//   btnText: { color: COLORS.text, fontWeight: 'bold' },

//   settingsSaveBtn: { backgroundColor: COLORS.blue, padding: 18, borderRadius: 8, alignItems: 'center', marginTop: 30 },
//   settingsSaveBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },
  
//   settingsAvatar: { width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: COLORS.blue, marginBottom: 10 },
//   editIconBadge: { position: 'absolute', bottom: 10, right: 10, backgroundColor: COLORS.blue, width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: COLORS.secondary },

//   statBoxLarge: { backgroundColor: COLORS.accent, padding: 20, alignItems: 'center', borderRadius: 12, marginTop: 20 },
//   bigStat: { color: COLORS.blue, fontSize: 40, fontWeight: 'bold' },
//   bigStatLbl: { color: COLORS.textDark, fontSize: 12, letterSpacing: 2 },

//   questPaperDark: { backgroundColor: COLORS.secondary, margin: 20, padding: 20, borderRadius: 8, borderWidth: 1, borderColor: COLORS.accent },
//   questTitleDark: { color: COLORS.text, fontSize: 20, fontWeight: 'bold', textAlign: 'center' },
//   difficulty: { color: COLORS.gold, textAlign: 'center', fontSize: 12, marginBottom: 10 },
//   objTitleDark: { color: COLORS.blue, fontWeight: 'bold', marginTop: 10 },
//   objRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
//   objTextDark: { color: COLORS.text },
//   objValDark: { color: COLORS.text, fontWeight: 'bold' },
//   divider: { height: 1, backgroundColor: COLORS.accent, marginVertical: 10 },
//   rewardTitleDark: { color: COLORS.text, fontWeight: 'bold' },
//   rewardText: { color: COLORS.blue, fontWeight: 'bold' },
//   acceptBtn: { backgroundColor: COLORS.blue, margin: 20, padding: 15, borderRadius: 8, alignItems: 'center' },
//   acceptBtnText: { color: COLORS.primary, fontWeight: 'bold', letterSpacing: 2 },

//   settingRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: COLORS.accent, alignItems: 'center' },
//   settingText: { color: COLORS.text, fontSize: 16 },

//   alertBox: { backgroundColor: COLORS.secondary, borderRadius: 12, borderWidth: 2, borderColor: COLORS.blue, padding: 20, width: '100%' },
//   alertTitle: { color: COLORS.blue, fontSize: 18, fontWeight: 'bold', textAlign: 'center', letterSpacing: 1 },
//   alertMessage: { color: COLORS.text, textAlign: 'center', marginVertical: 15 },
//   alertButtons: { flexDirection: 'row', justifyContent: 'center', marginTop: 10 },
//   alertButton: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 6, minWidth: 80, alignItems: 'center', marginHorizontal: 5 },
//   alertButtonDefault: { backgroundColor: COLORS.blue },
//   alertButtonDestructive: { backgroundColor: COLORS.danger },
//   alertButtonCancel: { backgroundColor: COLORS.accent },
//   alertButtonText: { color: COLORS.text, fontWeight: 'bold', fontSize: 12 },

//   timerCircle: { width: 120, height: 120, borderRadius: 60, borderWidth: 4, borderColor: COLORS.blue, justifyContent: 'center', alignItems: 'center', marginVertical: 30 },
//   timerText: { fontSize: 40, fontWeight: 'bold', color: COLORS.white },
// });






