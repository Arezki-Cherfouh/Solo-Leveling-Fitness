import { FontAwesome5, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Slider from "@react-native-community/slider";
import { Audio } from "expo-av";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import * as SQLite from "expo-sqlite";
import JSZip from "jszip";
import React, { useEffect, useRef, useState } from "react";
import { Animated, AppState, BackHandler, Dimensions, Image, Modal, Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, Vibration, View } from "react-native";
import { LineChart } from "react-native-chart-kit";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

const { width } = Dimensions.get('window');

type GoalType = 'muscle' | 'weight_loss' | 'speed_strength';
interface UserData { name: string; level: number; sex: 'male' | 'female'; weight: number; height: number; goal: GoalType; xp: number; totalWorkouts: number; createdAt: string; lastDailyQuestCompleted?: string; cameraEnabled: boolean; profileImage?: string; assessmentStats?: { [key: string]: number }; }
interface Exercise { name: string; iconName: string; iconLib: 'Ionicons' | 'MaterialCommunityIcons' | 'FontAwesome5'; type?: 'reps' | 'duration' | 'distance'; custom?: boolean; }
interface ExerciseConfig { [key: string]: Exercise; }
interface Quest { title: string; difficulty: number; exercises: { [key: string]: number }; rewards: { xp: number; title: string }; customExercises?: ExerciseConfig; isDaily?: boolean; }
interface TrainingResult { [key: string]: number; }
interface TrainingHistory { date: string; quest: Quest; results: TrainingResult; xpGained: number; durationSeconds?: number; }
interface MusicTrack { id: string; title: string; path: any; isLocal: boolean; isFavorite: boolean; artwork?: string; }
interface CustomProgram { id: string; name: string; exercises: { [key: string]: number }; customExercises?: ExerciseConfig; schedule: string[]; createdAt: string; }
interface AlertButton { text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive'; }
interface CustomAlertState { visible: boolean; title: string; message: string; buttons: AlertButton[]; }
interface CustomTimer { id: string; label: string; seconds: number; }
type PlaybackMode = 'loop_all' | 'play_all' | 'loop_one' | 'play_one';

const COLORS = { primary: '#050714', secondary: '#0F172A', accent: '#1E293B', highlight: '#2563EB', blue: '#3B82F6', lightBlue: '#60A5FA', purple: '#7C3AED', danger: '#EF4444', success: '#10B981', text: '#F8FAFC', textDark: '#94A3B8', glow: '#0EA5E9', gold: '#F59E0B', white: '#FFFFFF' };
const XP_PER_LEVEL_BASE = 600;
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EXERCISES: ExerciseConfig = {
  squats: { name: 'Squats', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
  pushups: { name: 'Push-ups', iconName: 'human-handsup', iconLib: 'MaterialCommunityIcons', type: 'reps' },
  situps: { name: 'Sit-ups', iconName: 'dumbbell', iconLib: 'FontAwesome5', type: 'reps' },
  pullups: { name: 'Pull-ups', iconName: 'human-male-height', iconLib: 'MaterialCommunityIcons', type: 'reps' },
  bicepCurls: { name: 'Bicep Curls', iconName: 'arm-flex', iconLib: 'MaterialCommunityIcons', type: 'reps' },
  lunges: { name: 'Lunges', iconName: 'run', iconLib: 'MaterialCommunityIcons', type: 'reps' },
  plank: { name: 'Plank (sec)', iconName: 'timer', iconLib: 'Ionicons', type: 'duration' },
  running: { name: 'Running (km)', iconName: 'run-fast', iconLib: 'MaterialCommunityIcons', type: 'distance' },
  clapPushups: { name: 'Clap Push-ups', iconName: 'flash', iconLib: 'MaterialCommunityIcons', type: 'reps' },
  jumpSquats: { name: 'Jump Squats', iconName: 'arrow-up-bold-circle', iconLib: 'MaterialCommunityIcons', type: 'reps' },
  burpees: { name: 'Burpees', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
};

class PoseCalculator {
  static calculateAngle(a: {x:number,y:number}, b: {x:number,y:number}, c: {x:number,y:number}) { const radians = Math.atan2(c.y-b.y,c.x-b.x)-Math.atan2(a.y-b.y,a.x-b.x); let angle = Math.abs(radians*180.0/Math.PI); if(angle>180.0) angle=360-angle; return angle; }
  static detectSquat(_landmarks: any): { angle: number } { return { angle: 0 }; }
  static isSupported(exerciseKey: string): boolean { return ['squats','pushups','situps','bicepCurls','lifting'].includes(exerciseKey); }
}

const SYSTEM_SOUND = require('../assets/audio/solo_leveling_system.mp3');
const DEFAULT_OST = require('../assets/audio/ost.mp3');
const getDayString = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'short' });
const getISODate = (date: Date) => date.toISOString().split('T')[0];
const formatTime = (seconds: number) => { const m = Math.floor(seconds/60); const s = Math.floor(seconds%60); return `${m}:${s<10?'0':''}${s}`; };
const pad2 = (n: number) => n < 10 ? `0${n}` : `${n}`;
const pad3 = (n: number) => n < 10 ? `00${n}` : n < 100 ? `0${n}` : `${n}`;
const formatStopwatch = (totalMs: number) => { const ms = totalMs % 1000; const totalSec = Math.floor(totalMs/1000); const sec = totalSec%60; const totalMin = Math.floor(totalSec/60); const min = totalMin%60; const totalHr = Math.floor(totalMin/60); const hr = totalHr%24; const days = Math.floor(totalHr/24); if (days > 0) return `${days}d ${pad2(hr)}:${pad2(min)}:${pad2(sec)}.${pad3(ms)}`; if (hr > 0) return `${pad2(hr)}:${pad2(min)}:${pad2(sec)}.${pad3(ms)}`; return `${pad2(min)}:${pad2(sec)}.${pad3(ms)}`; };
const formatCountdown = (totalSec: number) => { const sec = totalSec%60; const totalMin = Math.floor(totalSec/60); const min = totalMin%60; const totalHr = Math.floor(totalMin/60); const hr = totalHr%24; const days = Math.floor(totalHr/24); if (days > 0) return `${days}d ${pad2(hr)}:${pad2(min)}:${pad2(sec)}`; if (hr > 0) return `${pad2(hr)}:${pad2(min)}:${pad2(sec)}`; return `${pad2(min)}:${pad2(sec)}`; };
const parseLinkedDigits = (digits: string[]): { hours: number; minutes: number; seconds: number } => { const h = parseInt(digits.slice(0,2).join(''))||0; const m = parseInt(digits.slice(2,4).join(''))||0; const s = parseInt(digits.slice(4,6).join(''))||0; return { hours: Math.min(h,99), minutes: m, seconds: s }; };

// ── AsyncStorage → SQLite migration (runs once, marks done via 'sqlite_migrated' key) ──
async function migrateFromAsyncStorage(): Promise<void> {
  try {
    const already = await AsyncStorage.getItem('sqlite_migrated');
    if (already === '1') return; // already migrated, skip

    const db = await getDb();

    // userData
    try {
      const raw = await AsyncStorage.getItem('userData');
      if (raw) {
        const existing = await db.getFirstAsync<{id:number}>("SELECT id FROM user_data WHERE id=1");
        if (!existing) await db.runAsync("INSERT OR REPLACE INTO user_data (id,data) VALUES (1,?)", [raw]);
      }
    } catch {}

    // trainingHistory
    try {
      const raw = await AsyncStorage.getItem('trainingHistory');
      if (raw) {
        const history: TrainingHistory[] = JSON.parse(raw);
        const count = await db.getFirstAsync<{c:number}>("SELECT COUNT(*) as c FROM training_history");
        if (count?.c === 0) {
          for (const h of history) await db.runAsync("INSERT INTO training_history (date,quest,results,xp_gained,duration_seconds) VALUES (?,?,?,?,?)", [h.date, JSON.stringify(h.quest), JSON.stringify(h.results), h.xpGained, h.durationSeconds ?? 0]);
        }
      }
    } catch {}

    // customPrograms
    try {
      const raw = await AsyncStorage.getItem('customPrograms');
      if (raw) {
        const programs: CustomProgram[] = JSON.parse(raw);
        const count = await db.getFirstAsync<{c:number}>("SELECT COUNT(*) as c FROM custom_programs");
        if (count?.c === 0) {
          for (const p of programs) await db.runAsync("INSERT OR IGNORE INTO custom_programs (id,name,exercises,custom_exercises,schedule,created_at) VALUES (?,?,?,?,?,?)", [p.id, p.name, JSON.stringify(p.exercises), p.customExercises ? JSON.stringify(p.customExercises) : null, JSON.stringify(p.schedule), p.createdAt]);
        }
      }
    } catch {}

    // musicPlaylist (stored as JSON array in AsyncStorage)
    try {
      const raw = await AsyncStorage.getItem('musicPlaylist');
      if (raw) {
        const tracks: MusicTrack[] = JSON.parse(raw);
        const count = await db.getFirstAsync<{c:number}>("SELECT COUNT(*) as c FROM music_playlist WHERE id != 'default_ost'");
        if (count?.c === 0) {
          for (let i = 0; i < tracks.length; i++) {
            const t = tracks[i];
            if (t.id === 'default_ost') continue;
            await db.runAsync("INSERT OR IGNORE INTO music_playlist (id,title,path,is_local,is_favorite,artwork,sort_order) VALUES (?,?,?,?,?,?,?)", [t.id, t.title, typeof t.path === 'string' ? t.path : 'local_asset', t.isLocal ? 1 : 0, t.isFavorite ? 1 : 0, t.artwork || null, i]);
          }
        }
      }
    } catch {}

    // customTimers
    try {
      const raw = await AsyncStorage.getItem('customTimers');
      if (raw) {
        const timers: CustomTimer[] = JSON.parse(raw);
        const count = await db.getFirstAsync<{c:number}>("SELECT COUNT(*) as c FROM custom_timers");
        if (count?.c === 0) {
          for (let i = 0; i < timers.length; i++) await db.runAsync("INSERT OR IGNORE INTO custom_timers (id,label,seconds,sort_order) VALUES (?,?,?,?)", [timers[i].id, timers[i].label, timers[i].seconds, i]);
        }
      }
    } catch {}

    // Mark migration done so this never runs again
    await AsyncStorage.setItem('sqlite_migrated', '1');
    console.log('[Migration] AsyncStorage → SQLite complete');
  } catch (e) {
    console.warn('[Migration] Failed:', e);
    // Non-fatal — app continues with whatever is in SQLite
  }
}


let _db: SQLite.SQLiteDatabase | null = null;
const DB_SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS user_data (id INTEGER PRIMARY KEY DEFAULT 1, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS training_history (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, quest TEXT NOT NULL, results TEXT NOT NULL, xp_gained INTEGER NOT NULL, duration_seconds INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS custom_programs (id TEXT PRIMARY KEY, name TEXT NOT NULL, exercises TEXT NOT NULL, custom_exercises TEXT, schedule TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS music_playlist (id TEXT PRIMARY KEY, title TEXT NOT NULL, path TEXT NOT NULL, is_local INTEGER NOT NULL DEFAULT 1, is_favorite INTEGER NOT NULL DEFAULT 0, artwork TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS custom_timers (id TEXT PRIMARY KEY, label TEXT NOT NULL, seconds INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
`;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) { try { await _db.getFirstAsync("SELECT 1"); return _db; } catch { _db = null; } }
  _db = await SQLite.openDatabaseAsync("solo_leveling.db");
  await _db.execAsync(DB_SCHEMA);
  return _db;
}

async function dbGetUserData(): Promise<UserData | null> { const db = await getDb(); const row = await db.getFirstAsync<{data:string}>("SELECT data FROM user_data WHERE id=1"); return row ? JSON.parse(row.data) : null; }
async function dbSaveUserData(data: UserData): Promise<void> { const db = await getDb(); await db.runAsync("INSERT OR REPLACE INTO user_data (id,data) VALUES (1,?)", [JSON.stringify(data)]); }
async function dbGetHistory(): Promise<TrainingHistory[]> { const db = await getDb(); const rows = await db.getAllAsync<{date:string,quest:string,results:string,xp_gained:number,duration_seconds:number}>("SELECT * FROM training_history ORDER BY date DESC"); return rows.map(r => ({ date: r.date, quest: JSON.parse(r.quest), results: JSON.parse(r.results), xpGained: r.xp_gained, durationSeconds: r.duration_seconds })); }
async function dbAddHistory(entry: TrainingHistory): Promise<void> { const db = await getDb(); await db.runAsync("INSERT INTO training_history (date,quest,results,xp_gained,duration_seconds) VALUES (?,?,?,?,?)", [entry.date, JSON.stringify(entry.quest), JSON.stringify(entry.results), entry.xpGained, entry.durationSeconds ?? 0]); }
async function dbGetPrograms(): Promise<CustomProgram[]> { const db = await getDb(); const rows = await db.getAllAsync<any>("SELECT * FROM custom_programs ORDER BY created_at ASC"); return rows.map(r => ({ id: r.id, name: r.name, exercises: JSON.parse(r.exercises), customExercises: r.custom_exercises ? JSON.parse(r.custom_exercises) : undefined, schedule: JSON.parse(r.schedule), createdAt: r.created_at })); }
async function dbSaveProgram(p: CustomProgram): Promise<void> { const db = await getDb(); await db.runAsync("INSERT OR REPLACE INTO custom_programs (id,name,exercises,custom_exercises,schedule,created_at) VALUES (?,?,?,?,?,?)", [p.id, p.name, JSON.stringify(p.exercises), p.customExercises ? JSON.stringify(p.customExercises) : null, JSON.stringify(p.schedule), p.createdAt]); }
async function dbDeleteProgram(id: string): Promise<void> { const db = await getDb(); await db.runAsync("DELETE FROM custom_programs WHERE id=?", [id]); }
async function dbGetPlaylist(): Promise<MusicTrack[]> { const db = await getDb(); const rows = await db.getAllAsync<any>("SELECT * FROM music_playlist ORDER BY sort_order ASC, id ASC"); return rows.map(r => ({ id: r.id, title: r.title, path: r.is_local ? r.path : r.path, isLocal: r.is_local === 1, isFavorite: r.is_favorite === 1, artwork: r.artwork || undefined })); }
async function dbSaveTrack(t: MusicTrack, order = 0): Promise<void> { const db = await getDb(); await db.runAsync("INSERT OR REPLACE INTO music_playlist (id,title,path,is_local,is_favorite,artwork,sort_order) VALUES (?,?,?,?,?,?,?)", [t.id, t.title, typeof t.path === 'string' ? t.path : 'local_asset', t.isLocal ? 1 : 0, t.isFavorite ? 1 : 0, t.artwork || null, order]); }
async function dbDeleteTrack(id: string): Promise<void> { const db = await getDb(); await db.runAsync("DELETE FROM music_playlist WHERE id=?", [id]); }
async function dbGetTimers(): Promise<CustomTimer[]> { const db = await getDb(); const rows = await db.getAllAsync<any>("SELECT * FROM custom_timers ORDER BY sort_order ASC"); return rows.map(r => ({ id: r.id, label: r.label, seconds: r.seconds })); }
async function dbSaveTimer(t: CustomTimer, order = 0): Promise<void> { const db = await getDb(); await db.runAsync("INSERT OR REPLACE INTO custom_timers (id,label,seconds,sort_order) VALUES (?,?,?,?)", [t.id, t.label, t.seconds, order]); }
async function dbDeleteTimer(id: string): Promise<void> { const db = await getDb(); await db.runAsync("DELETE FROM custom_timers WHERE id=?", [id]); }

// ── ZIP Import/Export ─────────────────────────────────────────────────────────
// Reads a file URI into base64, returns null on failure
async function readFileB64(uri: string): Promise<string | null> {
  try { const info = await FileSystem.getInfoAsync(uri); if (!info.exists) return null; return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }); } catch { return null; }
}
// Returns the file extension from a URI, defaults to fallback
function uriExt(uri: string, fallback = 'bin'): string { const clean = uri.split('?')[0]; return clean.split('.').pop()?.toLowerCase() || fallback; }

async function exportDataZip(showAlert: (t: string, m: string) => void) {
  try {
    const [userData, history, programs, playlist, timers] = await Promise.all([dbGetUserData(), dbGetHistory(), dbGetPrograms(), dbGetPlaylist(), dbGetTimers()]);
    const zip = new JSZip();
    const filesFolder = zip.folder('files')!;

    // ── Profile image ──────────────────────────────────────────────────────────
    let profileFileRef: string | null = null;
    if (userData?.profileImage) {
      const uri = userData.profileImage;
      const b64 = await readFileB64(uri);
      if (b64) { const ext = uriExt(uri, 'jpg'); profileFileRef = `profile.${ext}`; filesFolder.file(profileFileRef, b64, { base64: true }); }
    }

    // ── Music tracks ───────────────────────────────────────────────────────────
    // For each non-default, non-bundled track, embed the audio file
    const playlistMeta = await Promise.all(playlist.map(async (t, i) => {
      if (t.id === 'default_ost' || t.isLocal || typeof t.path !== 'string') {
        // default/bundled asset — just record metadata, no file to embed
        return { ...t, path: null, fileRef: null };
      }
      const b64 = await readFileB64(t.path);
      if (!b64) return { ...t, path: null, fileRef: null };
      const ext = uriExt(t.path, 'mp3');
      const fileRef = `music_${t.id}.${ext}`;
      filesFolder.file(fileRef, b64, { base64: true });
      return { id: t.id, title: t.title, isLocal: false, isFavorite: t.isFavorite, artwork: t.artwork ?? null, path: null, fileRef, sortOrder: i };
    }));

    const manifest = {
      exportedAt: new Date().toISOString(),
      userData: userData ? { ...userData, profileImage: profileFileRef ? `files/${profileFileRef}` : null } : null,
      history, programs, timers,
      playlist: playlistMeta,
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    const fname = `SoloLeveling_${new Date().toISOString().slice(0, 10)}.zip`;
    const zipPath = FileSystem.cacheDirectory + fname;
    const zipB64 = await zip.generateAsync({ type: 'base64', compression: 'DEFLATE', compressionOptions: { level: 4 } });
    await FileSystem.writeAsStringAsync(zipPath, zipB64, { encoding: FileSystem.EncodingType.Base64 });

    if (Platform.OS === 'android') {
      try {
        const perms = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (perms.granted) { const dest = await FileSystem.StorageAccessFramework.createFileAsync(perms.directoryUri, fname, 'application/zip'); const b64 = await FileSystem.readAsStringAsync(zipPath, { encoding: FileSystem.EncodingType.Base64 }); await FileSystem.StorageAccessFramework.writeAsStringAsync(dest, b64, { encoding: FileSystem.EncodingType.Base64 }); showAlert('Export Complete', `Saved as ${fname}`); return; }
      } catch {}
    }
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(zipPath, { mimeType: 'application/zip', dialogTitle: 'Export SoloLeveling Data' });
    else showAlert('Export Complete', 'File saved to cache. Sharing not available on this device.');
  } catch (e) { showAlert('Export Error', String(e)); }
}

async function importDataZip(showAlert: (t: string, m: string) => void, onDone: () => void) {
  try {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/zip', copyToCacheDirectory: true });
    if (res.canceled) return;
    const zipB64 = await FileSystem.readAsStringAsync(res.assets[0].uri, { encoding: FileSystem.EncodingType.Base64 });
    const zip = await JSZip.loadAsync(zipB64, { base64: true });
    const mf = zip.file('manifest.json');
    if (!mf) { showAlert('Import Error', 'No manifest.json found in ZIP.'); return; }
    const manifest = JSON.parse(await mf.async('string'));
    const db = await getDb();
    const importDir = FileSystem.documentDirectory + 'SoloLevelingImport/';
    await FileSystem.makeDirectoryAsync(importDir, { intermediates: true });

    // ── Restore profile image ──────────────────────────────────────────────────
    if (manifest.userData) {
      let userData: UserData = manifest.userData;
      if (userData.profileImage) {
        const fileEntry = zip.file(userData.profileImage);
        if (fileEntry) {
          const b64 = await fileEntry.async('base64');
          const ext = uriExt(userData.profileImage, 'jpg');
          const dest = `${importDir}profile.${ext}`;
          await FileSystem.writeAsStringAsync(dest, b64, { encoding: FileSystem.EncodingType.Base64 });
          userData = { ...userData, profileImage: dest };
        }
      }
      await dbSaveUserData(userData);
    }

    if (manifest.history?.length) { await db.runAsync("DELETE FROM training_history"); for (const h of manifest.history) await dbAddHistory(h); }
    if (manifest.programs?.length) { await db.runAsync("DELETE FROM custom_programs"); for (const p of manifest.programs) await dbSaveProgram(p); }
    if (manifest.timers?.length) { await db.runAsync("DELETE FROM custom_timers"); for (let i = 0; i < manifest.timers.length; i++) await dbSaveTimer(manifest.timers[i], i); }

    // ── Restore music tracks ───────────────────────────────────────────────────
    if (manifest.playlist?.length) {
      await db.runAsync("DELETE FROM music_playlist WHERE id != 'default_ost'");
      for (let i = 0; i < manifest.playlist.length; i++) {
        const t = manifest.playlist[i];
        if (t.id === 'default_ost') continue;
        let restoredPath: string | null = null;
        if (t.fileRef) {
          const fileEntry = zip.file(`files/${t.fileRef}`);
          if (fileEntry) {
            const b64 = await fileEntry.async('base64');
            const dest = `${importDir}${t.fileRef}`;
            await FileSystem.writeAsStringAsync(dest, b64, { encoding: FileSystem.EncodingType.Base64 });
            restoredPath = dest;
          }
        }
        if (restoredPath) await dbSaveTrack({ ...t, path: restoredPath, isLocal: false }, i);
      }
    }

    showAlert('Import Complete', 'All data restored successfully.');
    onDone();
  } catch (e) { showAlert('Import Error', String(e)); }
}

const SoloIcon = ({ name, lib, size = 24, color = COLORS.text }: { name: string, lib: string, size?: number, color?: string }) => {
  if (lib==='Ionicons') return <Ionicons name={name as any} size={size} color={color} />;
  if (lib==='MaterialCommunityIcons') return <MaterialCommunityIcons name={name as any} size={size} color={color} />;
  if (lib==='FontAwesome5') return <FontAwesome5 name={name as any} size={size} color={color} />;
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
              <TouchableOpacity key={index} style={[styles.alertButton, btn.style==='destructive'?styles.alertButtonDestructive:btn.style==='cancel'?styles.alertButtonCancel:styles.alertButtonDefault]} onPress={() => { if(btn.onPress) btn.onPress(); onClose(); }}>
                <Text style={styles.alertButtonText}>{btn.text}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default function SoloLevelingFitnessTracker(): JSX.Element {
  const [screen, setScreenState] = useState<string>('loading');
  const [userData, setUserData] = useState<UserData | null>(null);
  const [customPrograms, setCustomPrograms] = useState<CustomProgram[]>([]);
  const [alertState, setAlertState] = useState<CustomAlertState>({ visible: false, title: '', message: '', buttons: [] });
  const [playlist, setPlaylist] = useState<MusicTrack[]>([]);
  const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [musicLoading, setMusicLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('loop_all');
  const playlistRef = useRef<MusicTrack[]>([]); const currentTrackRef = useRef<MusicTrack | null>(null); const playbackModeRef = useRef<PlaybackMode>('loop_all');
  useEffect(() => { playlistRef.current = playlist; }, [playlist]);
  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { playbackModeRef.current = playbackMode; }, [playbackMode]);
  const [systemSoundObj, setSystemSoundObj] = useState<Audio.Sound | null>(null);
  const [currentQuest, setCurrentQuest] = useState<Quest | null>(null);
  const [isTraining, setIsTraining] = useState<boolean>(false);

  const playSystemSound = async () => {
    try {
      if (systemSoundObj) await systemSoundObj.unloadAsync();
      if (sound && isPlaying) await sound.setVolumeAsync(0.1);
      const { sound: newSysSound } = await Audio.Sound.createAsync(SYSTEM_SOUND);
      setSystemSoundObj(newSysSound);
      await newSysSound.playAsync();
      newSysSound.setOnPlaybackStatusUpdate(async (status) => { if(status.isLoaded&&status.didJustFinish) { await newSysSound.unloadAsync(); setSystemSoundObj(null); if(sound&&isPlaying) await sound.setVolumeAsync(1.0); } });
    } catch (error) { console.log('System sound error', error); }
  };

  const navigateTo = (newScreen: string) => { if(newScreen!==screen) { playSystemSound(); setScreenState(newScreen); } };
  const showAlert = (title: string, message: string, buttons: AlertButton[] = [{ text: 'OK' }]) => { setAlertState({ visible: true, title, message, buttons }); };
  const closeAlert = () => { setAlertState(prev => ({ ...prev, visible: false })); };

  useEffect(() => {
    const backAction = () => {
      if (systemSoundObj) { try { systemSoundObj.stopAsync(); systemSoundObj.unloadAsync(); setSystemSoundObj(null); } catch(e) {} }
      if (screen==='dashboard'||screen==='loading'||screen==='setup') return false;
      if (screen==='training') { showAlert("Abort Mission?","Stop training?",[{text:"Cancel",style:"cancel"},{text:"Quit",style:"destructive",onPress:()=>navigateTo('dashboard')}]); return true; }
      navigateTo('dashboard'); return true;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [screen, systemSoundObj]);

  const reloadFromDb = async () => {
    const [programs, tracks, user] = await Promise.all([dbGetPrograms(), dbGetPlaylist(), dbGetUserData()]);
    setCustomPrograms(programs);
    const defaultTrack: MusicTrack = { id: 'default_ost', title: 'System Soundtrack (Default)', path: DEFAULT_OST, isLocal: true, isFavorite: true };
    const dbDefault = tracks.find(t => t.id === 'default_ost');
    if (!dbDefault) { await dbSaveTrack(defaultTrack, 0); }
    const finalTracks = [defaultTrack, ...tracks.filter(t => t.id !== 'default_ost')];
    setPlaylist(finalTracks);
    return user;
  };

  useEffect(() => {
    async function init() {
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false, staysActiveInBackground: true, playsInSilentModeIOS: true, shouldDuckAndroid: true, playThroughEarpieceAndroid: false }); } catch(e) { console.warn("Audio Mode Config Error:",e); }
      playSystemSound();
      await getDb(); // ensure schema
      await migrateFromAsyncStorage(); // one-time migration from old AsyncStorage data
      const user = await reloadFromDb();
      if (user) { const penalized = await checkPenalties(user, await dbGetPrograms()); setUserData(penalized); setScreenState('dashboard'); } else { setScreenState('setup'); }
    }
    init();
    return () => { if(sound) sound.unloadAsync(); if(systemSoundObj) systemSoundObj.unloadAsync(); };
  }, []);

  const checkPenalties = async (user: UserData, programs: CustomProgram[]): Promise<UserData> => {
    if (!user.lastDailyQuestCompleted) { const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1); user.lastDailyQuestCompleted = getISODate(yesterday); await dbSaveUserData(user); return user; }
    const todayStr = getISODate(new Date());
    if (user.lastDailyQuestCompleted===todayStr) return user;
    let penaltyXP = 0; let missedDays = 0;
    const checkDate = new Date(user.lastDailyQuestCompleted); checkDate.setDate(checkDate.getDate()+1);
    while (getISODate(checkDate)<todayStr) {
      const dailyPenaltyAmount = user.level*100; penaltyXP += dailyPenaltyAmount; missedDays++;
      await dbAddHistory({ date: checkDate.toISOString(), quest: { title:"PENALTY: MISSED QUEST", difficulty:0, exercises:{}, rewards:{xp:0,title:'None'} }, results:{}, xpGained:-dailyPenaltyAmount, durationSeconds:0 });
      checkDate.setDate(checkDate.getDate()+1);
    }
    if (penaltyXP>0) {
      let newXP = user.xp-penaltyXP; let newLevel = user.level;
      while (newXP<0) { if(newLevel>1) { newLevel--; newXP = newLevel*XP_PER_LEVEL_BASE+newXP; } else { newXP=0; break; } }
      user.xp = newXP; user.level = newLevel;
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1); user.lastDailyQuestCompleted = getISODate(yesterday);
      showAlert("PENALTY SYSTEM",`You failed to complete daily quests for ${missedDays} day(s).\n\nPUNISHMENT: -${penaltyXP} XP.`);
      await dbSaveUserData(user);
    }
    return user;
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (sound&&isPlaying) { interval = setInterval(async () => { try { const status = await sound.getStatusAsync(); if(status.isLoaded) { setPosition(status.positionMillis/1000); setDuration(status.durationMillis?status.durationMillis/1000:1); } } catch(e) {} }, 1000); }
    return () => clearInterval(interval);
  }, [sound, isPlaying]);

  const handleAutoNext = async (currentSound: Audio.Sound) => {
    const list = playlistRef.current; const curr = currentTrackRef.current; const mode = playbackModeRef.current;
    if (!curr||list.length===0) return;
    if (mode==='loop_one') await currentSound.replayAsync();
    else if (mode==='play_one') { setIsPlaying(false); setPosition(0); await currentSound.stopAsync(); await currentSound.setPositionAsync(0); }
    else if (mode==='play_all') { const idx=list.findIndex(t=>t.id===curr.id); if(idx!==-1&&idx<list.length-1) playTrack(list[idx+1]); else { setIsPlaying(false); setPosition(0); await currentSound.stopAsync(); await currentSound.setPositionAsync(0); } }
    else if (mode==='loop_all') { const idx=list.findIndex(t=>t.id===curr.id); playTrack(list[(idx+1)%list.length]); }
  };

  const saveUserData = async (data: UserData) => { await dbSaveUserData(data); setUserData(data); };

  const updateCustomPrograms = async (programs: CustomProgram[], deleted?: string) => {
    if (deleted) await dbDeleteProgram(deleted);
    else if (programs.length > 0) { const last = programs[programs.length-1]; await dbSaveProgram(last); }
    setCustomPrograms(programs);
  };

  const playTrack = async (track: MusicTrack) => {
    if (musicLoading) return;
    if (currentTrack?.id===track.id&&sound) { const status = await sound.getStatusAsync(); if(status.isLoaded&&!status.isPlaying) { await sound.playAsync(); setIsPlaying(true); return; } }
    try {
      setMusicLoading(true);
      if (sound) { await sound.unloadAsync(); setSound(null); }
      const source = track.isLocal ? track.path : { uri: track.path };
      const shouldLoop = playbackModeRef.current==='loop_one';
      const { sound: newSound } = await Audio.Sound.createAsync(source, { shouldPlay: true, isLooping: shouldLoop });
      newSound.setOnPlaybackStatusUpdate((status) => { if(status.isLoaded&&status.didJustFinish&&!status.isLooping) handleAutoNext(newSound); });
      if (isMuted) await newSound.setIsMutedAsync(true);
      setSound(newSound); setCurrentTrack(track); setIsPlaying(true); setMusicLoading(false);
    } catch (error) { console.log('Play Error',error); setMusicLoading(false); showAlert('Error','Could not play audio track.'); }
  };

  const togglePlayPause = async () => { if(!sound) { if(playlist.length>0) playTrack(playlist[0]); return; } if(musicLoading) return; if(isPlaying) { await sound.pauseAsync(); setIsPlaying(false); } else { await sound.playAsync(); setIsPlaying(true); } };
  const seekTrack = async (value: number) => { if(sound&&!musicLoading) { await sound.setPositionAsync(value*1000); setPosition(value); } };
  const skipToNext = () => { if(!currentTrack||playlist.length===0) return; const idx=playlist.findIndex(t=>t.id===currentTrack.id); playTrack(playlist[(idx+1)%playlist.length]); };
  const skipToPrev = () => { if(!currentTrack||playlist.length===0) return; const idx=playlist.findIndex(t=>t.id===currentTrack.id); playTrack(playlist[idx===0?playlist.length-1:idx-1]); };

  const deleteTrack = async (trackId: string) => {
    if (trackId==='default_ost') return;
    if (currentTrack?.id===trackId) { if(sound) await sound.unloadAsync(); setSound(null); setCurrentTrack(null); setIsPlaying(false); }
    await dbDeleteTrack(trackId);
    setPlaylist(prev => prev.filter(t => t.id !== trackId));
  };

  const addMusicFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({type:'audio/*'});
      if(!result.canceled&&result.assets&&result.assets.length>0) {
        const file=result.assets[0];
        const newTrack: MusicTrack={id:Date.now().toString(),title:file.name,path:file.uri,isLocal:false,isFavorite:false};
        await dbSaveTrack(newTrack, playlist.length);
        setPlaylist(prev => [...prev, newTrack]);
      }
    } catch(e) { showAlert('Error','Failed to pick audio file'); }
  };

  const MiniPlayer = () => {
    if (!currentTrack) return null;
    return (
      <TouchableOpacity activeOpacity={0.9} onPress={() => navigateTo('music')} style={styles.miniPlayerContainer}>
        <View style={styles.miniProgressContainer}><View style={[styles.miniProgressFill,{width:`${(position/(duration||1))*100}%`}]} /></View>
        <View style={styles.miniPlayerContent}>
          <View style={styles.miniInfo}>
            {currentTrack.artwork?(<Image source={{uri:currentTrack.artwork}} style={styles.miniArt}/>):(<Ionicons name="musical-note" size={20} color={COLORS.blue} style={{marginRight:10}}/>)}
            <View><Text style={styles.miniTitle} numberOfLines={1}>{currentTrack.title}</Text><Text style={styles.miniTime}>{formatTime(position)} / {formatTime(duration)}</Text></View>
          </View>
          <View style={styles.miniControls}>
            <TouchableOpacity onPress={(e)=>{e.stopPropagation();skipToPrev();}} style={styles.miniCtrlBtn}><Ionicons name="play-skip-back" size={20} color={COLORS.text}/></TouchableOpacity>
            <TouchableOpacity onPress={(e)=>{e.stopPropagation();togglePlayPause();}} style={styles.miniCtrlBtn}><Ionicons name={isPlaying?"pause":"play"} size={26} color={COLORS.white}/></TouchableOpacity>
            <TouchableOpacity onPress={(e)=>{e.stopPropagation();skipToNext();}} style={styles.miniCtrlBtn}><Ionicons name="play-skip-forward" size={20} color={COLORS.text}/></TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderScreen = () => {
    if (!userData&&screen!=='loading'&&screen!=='setup') return <LoadingScreen />;
    switch (screen) {
      case 'loading': return <LoadingScreen />;
      case 'setup': return <SetupScreen onComplete={(data) => { setUserData(data); setScreenState('assessment'); }} />;
      case 'assessment': return <AssessmentScreen userData={userData!} onComplete={(stats, calculatedLevel) => { const finalData={...userData!,level:calculatedLevel,assessmentStats:stats,createdAt:new Date().toISOString(),lastDailyQuestCompleted:getISODate(new Date())}; saveUserData(finalData); navigateTo('dashboard'); }} />;
      case 'dashboard': return <DashboardScreen userData={userData!} onNavigate={navigateTo} onStartQuest={() => navigateTo('quest')} />;
      case 'quest': return <QuestScreen userData={userData!} customPrograms={customPrograms} onBack={() => navigateTo('dashboard')} onStartTraining={(quest) => { setCurrentQuest(quest); setIsTraining(true); navigateTo('training'); }} />;
      case 'training': return <TrainingScreen userData={userData!} quest={currentQuest!} showAlert={showAlert} onComplete={(results, duration) => { updateProgress(results, duration); navigateTo('dashboard'); }} onBack={() => { showAlert("Abort Mission?","Stop training?",[{text:"Cancel",style:"cancel"},{text:"Quit",style:"destructive",onPress:()=>navigateTo('dashboard')}]); }} />;
      case 'stats': return <StatsScreen userData={userData!} onBack={() => navigateTo('dashboard')} />;
      case 'music': return <MusicScreen playlist={playlist} currentTrack={currentTrack} isPlaying={isPlaying} isLoading={musicLoading} position={position} duration={duration} playbackMode={playbackMode} onPlay={playTrack} onPause={togglePlayPause} onSeek={seekTrack} onNext={skipToNext} onPrev={skipToPrev} onDelete={deleteTrack} onAdd={addMusicFile} onToggleMode={async () => { const modes: PlaybackMode[]=['loop_all','play_all','loop_one','play_one']; const nextMode=modes[(modes.indexOf(playbackMode)+1)%modes.length]; setPlaybackMode(nextMode); if(sound) await sound.setIsLoopingAsync(nextMode==='loop_one'); }} onBack={() => navigateTo('dashboard')} />;
      case 'programs': return <CustomProgramsScreen userData={userData!} customPrograms={customPrograms} setCustomPrograms={updateCustomPrograms} onBack={() => navigateTo('dashboard')} onStartProgram={(quest) => { setCurrentQuest(quest); setIsTraining(true); navigateTo('training'); }} showAlert={showAlert} />;
      case 'settings': return <SettingsScreen userData={userData!} onSave={(data) => { saveUserData(data); navigateTo('dashboard'); }} onBack={() => navigateTo('dashboard')} showAlert={showAlert} onImportDone={() => { reloadFromDb().then(u => { if(u) setUserData(u); }); navigateTo('dashboard'); }} />;
      case 'timers': return <TimersScreen onBack={() => navigateTo('dashboard')} />;
      default: return <LoadingScreen />;
    }
  };

  const updateProgress = async (results: TrainingResult, duration: number) => {
    try {
      let xpGained = currentQuest?.isDaily ? currentQuest.rewards.xp : 100;
      const updatedUser = { ...userData! };
      if (currentQuest?.isDaily) updatedUser.lastDailyQuestCompleted = getISODate(new Date());
      await dbAddHistory({ date: new Date().toISOString(), quest: currentQuest!, results, xpGained, durationSeconds: duration });
      const xpNeeded = updatedUser.level*XP_PER_LEVEL_BASE; let newTotalXP = updatedUser.xp+xpGained; let newLevel = updatedUser.level; let leveledUp = false;
      while (newTotalXP>=xpNeeded) { newTotalXP -= xpNeeded; newLevel++; leveledUp = true; }
      const newUserData: UserData = { ...updatedUser, xp: newTotalXP, level: newLevel, totalWorkouts: (updatedUser.totalWorkouts||0)+1 };
      if (leveledUp) showAlert('LEVEL UP!',`You have reached Level ${newLevel}!`); else showAlert('QUEST COMPLETED',`You gained ${xpGained} Experience Points.`);
      saveUserData(newUserData);
    } catch (error) { console.error('Error updating progress:',error); }
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top','bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} translucent={false} />
        <View style={{ flex: 1 }}>{renderScreen()}</View>
        {currentTrack&&screen!=='music'&&<MiniPlayer />}
        <CustomAlert {...alertState} onClose={closeAlert} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function LoadingScreen() {
  const spinValue = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.loop(Animated.timing(spinValue,{toValue:1,duration:2000,useNativeDriver:true})).start(); }, []);
  const spin = spinValue.interpolate({inputRange:[0,1],outputRange:['0deg','360deg']});
  return (<View style={styles.centerContainer}><Animated.View style={{transform:[{rotate:spin}],marginBottom:20}}><Ionicons name="reload-circle-outline" size={60} color={COLORS.blue}/></Animated.View><Text style={styles.loadingTitle}>SOLO LEVELING</Text><Text style={styles.loadingSubtitle}>INITIALIZING SYSTEM...</Text></View>);
}

function SetupScreen({ onComplete }: { onComplete: (data: UserData) => void }) {
  const [formData, setFormData] = useState<any>({ name:'', level:1, sex:'male', weight:'', height:'', goal:'muscle' });
  const [image, setImage] = useState<string | null>(null);
  const pickImage = async () => { let result = await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Images,allowsEditing:true,aspect:[1,1],quality:0.5}); if(!result.canceled) setImage(result.assets[0].uri); };
  const handleNext = () => { if(!formData.name) return; onComplete({...formData,weight:parseFloat(formData.weight)||70,height:parseFloat(formData.height)||170,xp:0,totalWorkouts:0,createdAt:new Date().toISOString(),cameraEnabled:false,profileImage:image||undefined}); };
  const GoalButton = ({ type, icon, label }: { type: GoalType, icon: string, label: string }) => (<TouchableOpacity style={[styles.goalBtn,formData.goal===type&&styles.goalBtnActive]} onPress={() => setFormData({...formData,goal:type})}><MaterialCommunityIcons name={icon as any} size={24} color={formData.goal===type?COLORS.white:COLORS.blue}/><Text style={formData.goal===type?styles.goalTextActive:styles.goalText}>{label}</Text></TouchableOpacity>);
  return (
    <ScrollView style={styles.screenContainer} contentContainerStyle={{padding:20}} showsVerticalScrollIndicator={false}>
      <Text style={styles.headerTitle}>PLAYER REGISTRATION</Text>
      <TouchableOpacity onPress={pickImage} style={styles.avatarPicker}>{image?(<Image source={{uri:image}} style={styles.avatarImage}/>):(<View style={styles.avatarPlaceholder}><Ionicons name="camera" size={40} color={COLORS.textDark}/><Text style={styles.avatarText}>ADD PHOTO</Text></View>)}</TouchableOpacity>
      <View style={styles.formGroup}><Text style={styles.label}>HUNTER NAME</Text><TextInput style={styles.input} placeholder="Enter Name" placeholderTextColor={COLORS.textDark} onChangeText={t=>setFormData({...formData,name:t})}/></View>
      <View style={styles.formGroup}><Text style={styles.label}>GOAL / CLASS</Text><GoalButton type="muscle" icon="arm-flex" label="Muscle & Strength"/><GoalButton type="weight_loss" icon="run-fast" label="Weight Loss"/><GoalButton type="speed_strength" icon="flash" label="Speed & Strength (Assassin)"/></View>
      <View style={styles.formGroup}><Text style={styles.label}>GENDER</Text><View style={styles.genderContainer}><TouchableOpacity style={[styles.genderBtn,formData.sex==='male'&&styles.genderBtnActive]} onPress={() => setFormData({...formData,sex:'male'})}><Ionicons name="male" size={20} color={formData.sex==='male'?COLORS.white:COLORS.blue}/><Text style={formData.sex==='male'?styles.genderTextActive:styles.genderText}>MALE</Text></TouchableOpacity><TouchableOpacity style={[styles.genderBtn,formData.sex==='female'&&styles.genderBtnActive]} onPress={() => setFormData({...formData,sex:'female'})}><Ionicons name="female" size={20} color={formData.sex==='female'?COLORS.white:COLORS.blue}/><Text style={formData.sex==='female'?styles.genderTextActive:styles.genderText}>FEMALE</Text></TouchableOpacity></View></View>
      <View style={styles.row}><View style={[styles.formGroup,{flex:1,marginRight:10}]}><Text style={styles.label}>WEIGHT (KG)</Text><TextInput style={styles.input} keyboardType="numeric" onChangeText={t=>setFormData({...formData,weight:t})}/></View><View style={[styles.formGroup,{flex:1}]}><Text style={styles.label}>HEIGHT (CM)</Text><TextInput style={styles.input} keyboardType="numeric" onChangeText={t=>setFormData({...formData,height:t})}/></View></View>
      <TouchableOpacity style={styles.mainButton} onPress={handleNext}><Text style={styles.mainButtonText}>PROCEED TO EVALUATION</Text></TouchableOpacity>
    </ScrollView>
  );
}

function AssessmentScreen({ userData, onComplete }: { userData: UserData, onComplete: (stats: any, level: number) => void }) {
  const [step, setStep] = useState<'intro'|'active'|'rest'|'input'>('intro');
  const [currentExIndex, setCurrentExIndex] = useState(0);
  const [timer, setTimer] = useState(0);
  const [reps, setReps] = useState('');
  const [results, setResults] = useState<{[key:string]:number}>({});
  const appStateRef = useRef(AppState.currentState);
  const bgStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (appStateRef.current.match(/active/)&&nextState==='background') { bgStartTimeRef.current = Date.now(); }
      if (appStateRef.current==='background'&&nextState==='active') { if(bgStartTimeRef.current!==null) { const elapsed=Math.floor((Date.now()-bgStartTimeRef.current)/1000); bgStartTimeRef.current=null; setTimer(prev=>Math.max(0,prev-elapsed)); } }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, []);

  const getExercises = () => { if(userData.goal==='speed_strength') return ['pushups','jumpSquats','lunges']; else if(userData.goal==='weight_loss') return ['squats','situps','lunges']; else return ['pushups','squats','situps']; };
  const exercises = getExercises(); const currentEx = exercises[currentExIndex]; const EX_TIME = 60; const REST_TIME = 15;

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if ((step==='active'||step==='rest')&&timer>0) {
      interval = setInterval(() => {
        setTimer(prev => {
          if (prev<=1) {
            if (step==='active') { Vibration.vibrate(); setStep('input'); }
            else if (step==='rest') { if(currentExIndex<exercises.length-1) { setCurrentExIndex(prevIdx=>prevIdx+1); startExercise(); } else { finishAssessment(); } }
            return 0;
          }
          return prev-1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [step, timer]);

  const startExercise = () => { setTimer(EX_TIME); setStep('active'); setReps(''); };
  const handleInput = () => { const count=parseInt(reps)||0; setResults(prev=>({...prev,[currentEx]:count})); if(currentExIndex<exercises.length-1) { setTimer(REST_TIME); setStep('rest'); } else { finishAssessment(count); } };
  const finishAssessment = (lastReps?: number) => { const finalResults=lastReps?{...results,[currentEx]:lastReps}:results; let totalReps=0; Object.values(finalResults).forEach(val=>totalReps+=val); const calculatedLevel=Math.max(1,Math.floor(totalReps/40)+1); onComplete(finalResults,calculatedLevel); };

  return (
    <View style={styles.centerContainer}>
      <Text style={styles.headerTitle}>SYSTEM EVALUATION</Text>
      {step==='intro'&&(<View style={{padding:20,alignItems:'center'}}><Text style={styles.questTitleDark}>RANKING TEST</Text><Text style={styles.alertMessage}>You will perform 3 exercises to determine your Hunter Rank. {"\n\n"}1 Minute MAX reps for each.{"\n"}15 Seconds rest between sets.</Text>{exercises.map(e=>(<View key={e} style={{flexDirection:'row',marginVertical:5}}><SoloIcon name={EXERCISES[e].iconName} lib={EXERCISES[e].iconLib} color={COLORS.blue}/><Text style={{color:COLORS.text,marginLeft:10}}>{EXERCISES[e].name}</Text></View>))}<TouchableOpacity style={styles.mainButton} onPress={startExercise}><Text style={styles.mainButtonText}>START TEST</Text></TouchableOpacity></View>)}
      {step==='active'&&(<View style={{alignItems:'center'}}><Text style={styles.loadingSubtitle}>CURRENT EXERCISE</Text><Text style={styles.loadingTitle}>{EXERCISES[currentEx].name}</Text><View style={styles.timerCircle}><Text style={styles.timerText}>{timer}</Text></View><Text style={styles.label}>DO AS MANY AS YOU CAN</Text><TouchableOpacity style={[styles.mainButton,{backgroundColor:COLORS.accent,marginTop:15,paddingHorizontal:30}]} onPress={() => { Vibration.vibrate(); setTimer(0); setStep('input'); }}><Text style={[styles.mainButtonText,{color:COLORS.gold}]}>SKIP (ENTER RESULT)</Text></TouchableOpacity></View>)}
      {step==='input'&&(<View style={{alignItems:'center',width:'80%'}}><Text style={styles.questTitleDark}>TIME'S UP</Text><Text style={styles.label}>ENTER REPS COMPLETED:</Text><TextInput style={[styles.input,{textAlign:'center',fontSize:24,width:100}]} keyboardType="numeric" value={reps} onChangeText={setReps} autoFocus/><TouchableOpacity style={styles.mainButton} onPress={handleInput}><Text style={styles.mainButtonText}>CONFIRM</Text></TouchableOpacity></View>)}
      {step==='rest'&&(<View style={{alignItems:'center'}}><Text style={styles.loadingTitle}>REST</Text><Text style={styles.timerText}>{timer}</Text><Text style={styles.loadingSubtitle}>NEXT: {EXERCISES[exercises[currentExIndex+1]]?.name}</Text><TouchableOpacity style={[styles.mainButton,{backgroundColor:COLORS.accent,marginTop:20,paddingHorizontal:30}]} onPress={() => { setTimer(0); if(currentExIndex<exercises.length-1) { setCurrentExIndex(prev=>prev+1); startExercise(); } else finishAssessment(); }}><Text style={[styles.mainButtonText,{color:COLORS.gold}]}>SKIP REST</Text></TouchableOpacity></View>)}
    </View>
  );
}

function DashboardScreen({ userData, onNavigate, onStartQuest }: any) {
  if (!userData) return null;
  const xpPercent = (Math.max(0,userData.xp)/(userData.level*XP_PER_LEVEL_BASE))*100;
  return (
    <ScrollView style={styles.screenContainer} showsVerticalScrollIndicator={false}>
      <View style={styles.dashboardHeader}>
        <View style={styles.profileRow}>
          <Image source={userData.profileImage?{uri:userData.profileImage}:{uri:'https://via.placeholder.com/150'}} style={styles.profileImageSmall}/>
          <View><Text style={styles.playerName}>{userData.name}</Text><Text style={styles.playerRank}>LEVEL {userData.level}</Text><Text style={{color:COLORS.gold,fontSize:10,letterSpacing:1}}>CLASS: {userData.goal.replace('_',' ').toUpperCase()}</Text></View>
        </View>
      </View>
      <View style={styles.systemWindow}>
        <Text style={styles.systemHeader}>STATUS</Text>
        <View style={styles.xpBarContainer}><View style={[styles.xpBarFill,{width:`${xpPercent}%`}]}/></View>
        <Text style={styles.xpText}>{userData.xp} / {userData.level*XP_PER_LEVEL_BASE} XP</Text>
        <View style={styles.statGrid}>
          <View style={styles.statItem}><Ionicons name="barbell-outline" size={20} color={COLORS.blue}/><Text style={styles.statVal}>{userData.totalWorkouts}</Text><Text style={styles.statLbl}>Raids</Text></View>
          <View style={styles.statItem}><MaterialCommunityIcons name="fire" size={20} color={COLORS.danger}/><Text style={styles.statVal}>{userData.level}</Text><Text style={styles.statLbl}>Rank</Text></View>
        </View>
      </View>
      <View style={styles.menuGrid}>
        <TouchableOpacity style={styles.menuCardLarge} onPress={onStartQuest}><MaterialCommunityIcons name="sword-cross" size={40} color={COLORS.gold}/><Text style={styles.menuTitle}>DAILY QUEST</Text><Text style={styles.menuSub}>{userData.lastDailyQuestCompleted===getISODate(new Date())?'Completed':'Available'}</Text></TouchableOpacity>
        <View style={styles.menuRow}>
          <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('programs')}><Ionicons name="list" size={24} color={COLORS.blue}/><Text style={styles.menuTitleSmall}>Programs</Text></TouchableOpacity>
          <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('stats')}><Ionicons name="stats-chart" size={24} color={COLORS.success}/><Text style={styles.menuTitleSmall}>Stats</Text></TouchableOpacity>
        </View>
        <View style={styles.menuRow}>
          <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('music')}><Ionicons name="musical-notes" size={24} color={COLORS.purple}/><Text style={styles.menuTitleSmall}>Music</Text></TouchableOpacity>
          <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('timers')}><Ionicons name="timer-outline" size={24} color={COLORS.gold}/><Text style={styles.menuTitleSmall}>Timers</Text></TouchableOpacity>
        </View>
        <View style={styles.menuRow}>
          <TouchableOpacity style={[styles.menuCardSmall,{width:'100%'}]} onPress={() => onNavigate('settings')}><Ionicons name="settings" size={24} color={COLORS.textDark}/><Text style={styles.menuTitleSmall}>Settings</Text></TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

function Stopwatch() {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [running, setRunning] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const accumulatedRef = useRef(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const bgEnterTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (appStateRef.current.match(/active/) && nextState === 'background' && running) { bgEnterTimeRef.current = Date.now(); if (startTimeRef.current !== null) { accumulatedRef.current += Date.now() - startTimeRef.current; startTimeRef.current = null; } }
      if (appStateRef.current === 'background' && nextState === 'active' && running) { if (bgEnterTimeRef.current !== null) { accumulatedRef.current += Date.now() - bgEnterTimeRef.current; bgEnterTimeRef.current = null; } startTimeRef.current = Date.now(); }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [running]);

  const start = () => { if (running) return; startTimeRef.current = Date.now(); setRunning(true); intervalRef.current = setInterval(() => { const base = startTimeRef.current ? Date.now()-startTimeRef.current : 0; setElapsedMs(accumulatedRef.current+base); }, 33); };
  const pause = () => { if (!running) return; if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } if (startTimeRef.current !== null) { accumulatedRef.current += Date.now()-startTimeRef.current; startTimeRef.current = null; } setRunning(false); };
  const reset = () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } startTimeRef.current = null; accumulatedRef.current = 0; setElapsedMs(0); setRunning(false); };
  useEffect(() => { return () => { if(intervalRef.current) clearInterval(intervalRef.current); }; }, []);

  const ms = elapsedMs%1000; const totalSec = Math.floor(elapsedMs/1000); const sec = totalSec%60;
  const totalMin = Math.floor(totalSec/60); const min = totalMin%60;
  const totalHr = Math.floor(totalMin/60); const hr = totalHr%24; const days = Math.floor(totalHr/24);
  const showHours = totalHr > 0; const showDays = days > 0;

  const ArcRing = ({ fill, color, label, value }: { fill: number; color: string; label: string; value: string }) => (
    <View style={{alignItems:'center',marginHorizontal:5}}>
      <View style={{width:50,height:50,borderRadius:25,justifyContent:'center',alignItems:'center'}}>
        <View style={{position:'absolute',width:50,height:50,borderRadius:25,borderWidth:4,borderColor:COLORS.accent}}/>
        <View style={{position:'absolute',width:50,height:50,borderRadius:25,borderWidth:4,borderColor:color,opacity:Math.max(0.15,fill),transform:[{rotate:`${-90+fill*360}deg`}]}}/>
        <View style={{position:'absolute',width:34,height:34,borderRadius:17,backgroundColor:COLORS.secondary}}/>
        <Text style={{color:COLORS.white,fontSize:11,fontWeight:'800',zIndex:2}}>{value}</Text>
      </View>
      <Text style={{color,fontSize:8,fontWeight:'bold',marginTop:3,letterSpacing:1}}>{label}</Text>
    </View>
  );

  return (
    <View style={{backgroundColor:COLORS.secondary,borderRadius:14,padding:16,marginBottom:20,borderWidth:1,borderColor:COLORS.purple}}>
      <Text style={[styles.label,{color:COLORS.purple,marginBottom:12,textAlign:'center',letterSpacing:2}]}>STOPWATCH</Text>
      <Text style={{color:COLORS.white,fontSize:30,fontWeight:'900',textAlign:'center',letterSpacing:2,marginBottom:14}}>
        {showDays?`${days}d `:''}{showHours?`${pad2(hr)}:`:''}
        {pad2(min)}:{pad2(sec)}<Text style={{fontSize:18,color:COLORS.textDark}}>.{pad3(ms)}</Text>
      </Text>
      <View style={{flexDirection:'row',justifyContent:'center',marginBottom:14}}>
        {showDays&&<ArcRing fill={Math.min(days/6,1)} color={COLORS.gold} label="DAYS" value={`${days}`}/>}
        {showHours&&<ArcRing fill={hr/23} color={COLORS.danger} label="HRS" value={pad2(hr)}/>}
        <ArcRing fill={min/59} color={COLORS.blue} label="MIN" value={pad2(min)}/>
        <ArcRing fill={sec/59} color={COLORS.success} label="SEC" value={pad2(sec)}/>
        <ArcRing fill={ms/999} color={COLORS.purple} label="MS" value={pad3(ms)}/>
      </View>
      <View style={{flexDirection:'row',justifyContent:'center'}}>
        <TouchableOpacity style={[styles.timerCtrlBtn,{backgroundColor:running?COLORS.accent:COLORS.purple,marginRight:10}]} onPress={running?pause:start}><Ionicons name={running?"pause":"play"} size={22} color={COLORS.white}/><Text style={styles.timerCtrlText}>{running?'PAUSE':'START'}</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.timerCtrlBtn,{backgroundColor:COLORS.accent}]} onPress={reset}><Ionicons name="refresh" size={22} color={COLORS.text}/><Text style={styles.timerCtrlText}>RESET</Text></TouchableOpacity>
      </View>
    </View>
  );
}

function TimersScreen({ onBack }: { onBack: () => void }) {
  const [customTimers, setCustomTimers] = useState<CustomTimer[]>([]);
  const [activeTimers, setActiveTimers] = useState<{[id:string]: number}>({});
  const [runningTimers, setRunningTimers] = useState<{[id:string]: boolean}>({});
  const [digits, setDigits] = useState<string[]>(['0','0','0','0','0','0']);
  const [newLabel, setNewLabel] = useState('');
  const [loaded, setLoaded] = useState(false);
  const intervalsRef = useRef<{[id:string]: NodeJS.Timeout}>({});
  const bgStartRef = useRef<{[id:string]: number}>({});
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    dbGetTimers().then(timers => {
      setCustomTimers(timers);
      const init: {[id:string]:number}={};
      timers.forEach(t=>init[t.id]=t.seconds);
      setActiveTimers(init);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (appStateRef.current.match(/active/)&&nextState==='background') { Object.keys(runningTimers).forEach(id => { if(runningTimers[id]) bgStartRef.current[id]=Date.now(); }); }
      if (appStateRef.current==='background'&&nextState==='active') { const elapsed: {[id:string]:number}={}; Object.keys(bgStartRef.current).forEach(id => { elapsed[id]=Math.floor((Date.now()-bgStartRef.current[id])/1000); delete bgStartRef.current[id]; }); if (Object.keys(elapsed).length>0) setActiveTimers(prev => { const next={...prev}; Object.keys(elapsed).forEach(id => { next[id]=Math.max(0,(next[id]||0)-elapsed[id]); }); return next; }); }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [runningTimers]);

  // Calculator style: new digit always enters at seconds-units slot (index 5, rightmost).
  // Existing digits shift LEFT one position. If the leftmost slot (index 0) is already
  // non-zero, the display is "full" — reject new input so nothing gets overwritten.
  const pushDigit = (d: string) => setDigits(prev => {
    if (prev[0] !== '0') return prev; // all 6 slots filled, stop
    return [...prev.slice(1), d];
  });
  const clearDigits = () => setDigits(['0','0','0','0','0','0']);
  // Backspace: pop rightmost, shift everything right, insert '0' at left
  const backspaceDigit = () => setDigits(prev => ['0', ...prev.slice(0, 5)]);
  const { hours, minutes, seconds } = parseLinkedDigits(digits);
  const totalSeconds = hours*3600 + minutes*60 + seconds;

  const addTimer = async () => {
    if (totalSeconds<=0) return;
    const id = Date.now().toString();
    const label = newLabel || `${hours>0?hours+'h ':''} ${minutes>0?minutes+'m ':''} ${seconds>0?seconds+'s':''}`.trim().replace(/\s+/g,' ');
    const timer: CustomTimer = { id, label, seconds: totalSeconds };
    await dbSaveTimer(timer, customTimers.length);
    const updated = [...customTimers, timer];
    setCustomTimers(updated); setActiveTimers(prev => ({...prev,[id]:totalSeconds})); setNewLabel(''); clearDigits();
  };

  const deleteTimer = async (id: string) => {
    if (intervalsRef.current[id]) { clearInterval(intervalsRef.current[id]); delete intervalsRef.current[id]; }
    setRunningTimers(prev => { const n={...prev}; delete n[id]; return n; });
    setActiveTimers(prev => { const n={...prev}; delete n[id]; return n; });
    await dbDeleteTimer(id);
    setCustomTimers(prev => prev.filter(t=>t.id!==id));
  };

  const startTimer = (id: string) => {
    if (intervalsRef.current[id]) return;
    setRunningTimers(prev => ({...prev,[id]:true}));
    intervalsRef.current[id] = setInterval(() => {
      setActiveTimers(prev => {
        const cur = (prev[id]||0); if(cur<=1) { clearInterval(intervalsRef.current[id]); delete intervalsRef.current[id]; setRunningTimers(p=>({...p,[id]:false})); Vibration.vibrate([0,500,200,500]); return {...prev,[id]:0}; }
        return {...prev,[id]:cur-1};
      });
    }, 1000);
  };
  const pauseTimer = (id: string) => { if(intervalsRef.current[id]) { clearInterval(intervalsRef.current[id]); delete intervalsRef.current[id]; } setRunningTimers(prev=>({...prev,[id]:false})); };
  const resetTimer = (id: string) => { pauseTimer(id); const original = customTimers.find(t=>t.id===id); if(original) setActiveTimers(prev=>({...prev,[id]:original.seconds})); };
  useEffect(() => { return () => { Object.values(intervalsRef.current).forEach(clearInterval); }; }, []);

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>TIMERS</Text><View style={{width:24}}/></View>
      <ScrollView style={{padding:20}} showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom:30}}>
        <Stopwatch />
        <View style={{backgroundColor:COLORS.secondary,borderRadius:14,padding:16,marginBottom:20,borderWidth:1,borderColor:COLORS.accent}}>
          <Text style={[styles.label,{marginBottom:12,textAlign:'center',letterSpacing:2}]}>CREATE COUNTDOWN TIMER</Text>
          <View style={{flexDirection:'row',justifyContent:'center',alignItems:'center',marginBottom:14}}>
            <View style={styles.linkedSegment}><Text style={styles.linkedLabel}>HH</Text><Text style={styles.linkedValue}>{pad2(hours)}</Text></View>
            <Text style={styles.linkedSep}>:</Text>
            <View style={styles.linkedSegment}><Text style={styles.linkedLabel}>MM</Text><Text style={styles.linkedValue}>{pad2(minutes)}</Text></View>
            <Text style={styles.linkedSep}>:</Text>
            <View style={styles.linkedSegment}><Text style={styles.linkedLabel}>SS</Text><Text style={styles.linkedValue}>{pad2(seconds)}</Text></View>
          </View>
          <View style={{marginBottom:10}}>
            {[['1','2','3'],['4','5','6'],['7','8','9'],['C','0','⌫']].map((row, ri) => (
              <View key={ri} style={{flexDirection:'row',justifyContent:'center',marginBottom:6}}>
                {row.map(key => (
                  <TouchableOpacity key={key} style={styles.numpadBtn} onPress={() => { if (key==='C') clearDigits(); else if (key==='⌫') backspaceDigit(); else pushDigit(key); }}>
                    <Text style={[styles.numpadText, key==='C'&&{color:COLORS.danger}, key==='⌫'&&{color:COLORS.gold}]}>{key}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </View>
          <TextInput style={[styles.input,{marginBottom:8}]} placeholder="Label (optional)" placeholderTextColor={COLORS.textDark} value={newLabel} onChangeText={setNewLabel}/>
          <TouchableOpacity style={[styles.mainButton,{marginTop:0,opacity:totalSeconds>0?1:0.4}]} onPress={addTimer} disabled={totalSeconds<=0}><Text style={styles.mainButtonText}>ADD TIMER</Text></TouchableOpacity>
        </View>
        {customTimers.length===0&&<Text style={{color:COLORS.textDark,textAlign:'center',marginTop:10,marginBottom:20}}>No countdown timers yet.</Text>}
        {customTimers.map(timer => {
          const remaining = activeTimers[timer.id]??timer.seconds;
          const isRunning = runningTimers[timer.id]||false;
          const progress = timer.seconds > 0 ? remaining/timer.seconds : 0;
          const finished = remaining===0;
          return (
            <View key={timer.id} style={{backgroundColor:COLORS.secondary,borderRadius:12,padding:20,marginBottom:15,borderWidth:1,borderColor:finished?COLORS.gold:isRunning?COLORS.blue:COLORS.accent}}>
              <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <Text style={{color:COLORS.text,fontWeight:'bold',fontSize:16}}>{timer.label}</Text>
                <TouchableOpacity onPress={() => deleteTimer(timer.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger}/></TouchableOpacity>
              </View>
              <View style={{height:4,backgroundColor:COLORS.accent,borderRadius:2,marginBottom:12}}><View style={{height:'100%',width:`${Math.max(0,progress*100)}%`,backgroundColor:finished?COLORS.gold:COLORS.blue,borderRadius:2}}/></View>
              <Text style={{color:finished?COLORS.gold:COLORS.white,fontSize:44,fontWeight:'900',textAlign:'center',letterSpacing:2,marginBottom:8}}>{formatCountdown(remaining)}</Text>
              {finished&&<Text style={{color:COLORS.gold,textAlign:'center',fontWeight:'bold',letterSpacing:2,marginBottom:8}}>⚡ TIME'S UP!</Text>}
              <View style={{flexDirection:'row',justifyContent:'center'}}>
                <TouchableOpacity style={[styles.timerCtrlBtn,{backgroundColor:isRunning?COLORS.accent:COLORS.blue,marginRight:10}]} onPress={() => isRunning?pauseTimer(timer.id):startTimer(timer.id)}><Ionicons name={isRunning?"pause":"play"} size={22} color={COLORS.white}/><Text style={styles.timerCtrlText}>{isRunning?'PAUSE':'START'}</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.timerCtrlBtn,{backgroundColor:COLORS.accent}]} onPress={() => resetTimer(timer.id)}><Ionicons name="refresh" size={22} color={COLORS.text}/><Text style={styles.timerCtrlText}>RESET</Text></TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function MusicScreen({ playlist, currentTrack, isPlaying, isLoading, position, duration, playbackMode, onPlay, onPause, onSeek, onNext, onPrev, onDelete, onAdd, onToggleMode, onBack }: any) {
  const [searchQuery, setSearchQuery] = useState('');
  const getModeIcon = () => { switch(playbackMode) { case 'loop_one': return 'repeat-once'; case 'loop_all': return 'repeat'; case 'play_one': return 'numeric-1-box-outline'; case 'play_all': return 'playlist-play'; default: return 'repeat'; } };
  const filteredPlaylist = playlist.filter((track: MusicTrack) => track.title.toLowerCase().includes(searchQuery.toLowerCase()));
  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>MUSIC PLAYER</Text><TouchableOpacity onPress={onToggleMode} style={styles.modeBtnHeader}><MaterialCommunityIcons name={getModeIcon()} size={20} color={COLORS.blue}/></TouchableOpacity></View>
      <View style={styles.playerMain}>
        {currentTrack&&currentTrack.artwork?(<Image source={{uri:currentTrack.artwork}} style={styles.albumArt}/>):(<View style={styles.albumArtPlaceholder}><Ionicons name="musical-note" size={80} color={COLORS.highlight}/></View>)}
        <Text style={styles.nowPlayingTitle} numberOfLines={1}>{currentTrack?currentTrack.title:'Select a Track'}</Text>
        <View style={styles.seekContainer}><Text style={styles.timeText}>{formatTime(position)}</Text><Slider style={{flex:1,marginHorizontal:10}} minimumValue={0} maximumValue={duration>0?duration:1} value={position} minimumTrackTintColor={COLORS.highlight} maximumTrackTintColor={COLORS.accent} thumbTintColor={COLORS.blue} onSlidingComplete={onSeek}/><Text style={styles.timeText}>{formatTime(duration)}</Text></View>
        <View style={styles.playerControlsMain}>
          <TouchableOpacity onPress={onPrev} style={styles.ctrlBtn}><Ionicons name="play-skip-back" size={30} color={COLORS.text}/></TouchableOpacity>
          <TouchableOpacity onPress={onPause} style={styles.playButtonLarge}>{isLoading?(<View style={{width:30,height:30,borderWidth:3,borderRadius:15,borderColor:COLORS.primary,borderTopColor:COLORS.blue}}/>):(<Ionicons name={isPlaying?"pause":"play"} size={40} color={COLORS.primary}/>)}</TouchableOpacity>
          <TouchableOpacity onPress={onNext} style={styles.ctrlBtn}><Ionicons name="play-skip-forward" size={30} color={COLORS.text}/></TouchableOpacity>
        </View>
      </View>
      <View style={styles.playlistHeader}><Text style={styles.sectionTitle}>PLAYLIST</Text><TouchableOpacity onPress={onAdd} style={styles.addBtn}><Ionicons name="add" size={20} color={COLORS.primary}/></TouchableOpacity></View>
      <View style={{paddingHorizontal:20,marginBottom:5}}><View style={styles.searchContainer}><Ionicons name="search" size={20} color={COLORS.textDark}/><TextInput style={styles.searchInput} placeholder="Search tracks..." placeholderTextColor={COLORS.textDark} value={searchQuery} onChangeText={setSearchQuery}/></View></View>
      <ScrollView style={styles.playlistContainer} contentContainerStyle={{paddingBottom:20}} showsVerticalScrollIndicator={false}>
        {filteredPlaylist.map((track: MusicTrack) => (
          <View key={track.id} style={[styles.trackRow,currentTrack?.id===track.id&&styles.trackActive]}>
            <TouchableOpacity style={styles.trackInfoArea} onPress={() => onPlay(track)}><View style={styles.trackIcon}><Ionicons name="musical-notes-outline" size={20} color={currentTrack?.id===track.id?COLORS.white:COLORS.textDark}/></View><Text style={[styles.trackName,currentTrack?.id===track.id&&styles.trackNameActive]} numberOfLines={1}>{track.title}</Text></TouchableOpacity>
            <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(track.id)}><Ionicons name="trash-outline" size={18} color={COLORS.danger}/></TouchableOpacity>
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
  const [workoutMs, setWorkoutMs] = useState(0);
  const [activeExercise, setActiveExercise] = useState<string | null>(null);
  const [manualInputs, setManualInputs] = useState<{[key:string]:string}>({});
  const cameraRef = useRef<any>(null);
  const appStateRef = useRef(AppState.currentState);
  const startTimeRef = useRef<number>(Date.now());
  const accumulatedMsRef = useRef(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!permission) requestPermission();
    const initCounts: any = {}; Object.keys(quest.exercises).forEach(k => initCounts[k]=0); setCounts(initCounts);
  }, [permission]);

  const bgEnterTimeTRef = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      if (appStateRef.current.match(/active/) && nextState === 'background') { bgEnterTimeTRef.current = Date.now(); accumulatedMsRef.current += Date.now() - startTimeRef.current; startTimeRef.current = Date.now(); }
      if (appStateRef.current === 'background' && nextState === 'active') { if (bgEnterTimeTRef.current !== null) { accumulatedMsRef.current += Date.now() - bgEnterTimeTRef.current; bgEnterTimeTRef.current = null; } startTimeRef.current = Date.now(); }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    startTimeRef.current = Date.now();
    intervalRef.current = setInterval(() => { setWorkoutMs(accumulatedMsRef.current+(Date.now()-startTimeRef.current)); }, 33);
    return () => { if(intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const handleManualAdd = (ex: string, target: number) => { const amount=parseInt(manualInputs[ex]||'0'); if(amount>0) { const current=counts[ex]||0; const newVal=Math.min(current+amount,target); setCounts({...counts,[ex]:newVal}); setManualInputs({...manualInputs,[ex]:''}); } };
  const handleDecrease = (ex: string) => { const current=counts[ex]||0; if(current>0) setCounts({...counts,[ex]:current-1}); };
  const handleCheckAll = () => { showAlert("Complete All?","Mark all exercises as finished?",[{text:"Cancel",style:"cancel"},{text:"Yes",onPress:()=>setCounts(quest.exercises)}]); };
  const isCompleted = (ex: string) => (counts[ex]||0)>=quest.exercises[ex];
  const allCompleted = Object.keys(quest.exercises).every(isCompleted);
  const isPoseSupported = (exKey: string) => PoseCalculator.isSupported(exKey);
  const workoutSec = Math.floor(workoutMs/1000);

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}><Ionicons name="close" size={24} color={COLORS.danger}/></TouchableOpacity>
        <Text style={styles.headerTitle}>DUNGEON INSTANCE</Text>
        <TouchableOpacity onPress={() => setCameraType(cameraType==='back'?'front':'back')}><Ionicons name="camera-reverse" size={24} color={COLORS.blue}/></TouchableOpacity>
      </View>
      <View style={styles.workoutTimerBanner}>
        <Ionicons name="timer-outline" size={18} color={COLORS.gold}/>
        <Text style={styles.workoutTimerText}>{formatStopwatch(workoutMs)}</Text>
      </View>
      {userData.cameraEnabled&&(
        <View style={styles.cameraContainer}>
          {permission?.granted?(
            <CameraView style={styles.camera} facing={cameraType as any} ref={cameraRef}>
              <View style={styles.cameraOverlay}>
                <Text style={styles.detectionText}>SYSTEM: POSE TRACKING ACTIVE</Text>
                {activeExercise&&!isPoseSupported(activeExercise)?(<View style={styles.camWarningBox}><Text style={styles.camWarningText}>CANNOT DETECT WITH CAM</Text></View>):(<View style={styles.poseBox}/>)}
                {activeExercise&&isPoseSupported(activeExercise)&&(<View style={styles.poseInfoBox}><Text style={styles.poseInfoText}>Detecting: {EXERCISES[activeExercise]?.name||activeExercise}</Text><Text style={styles.poseInfoSub}>Ensure full body visibility</Text></View>)}
              </View>
            </CameraView>
          ):(
            <View style={styles.cameraOff}><Ionicons name="videocam-off" size={40} color={COLORS.textDark}/><Text style={styles.cameraOffText}>CAMERA DISABLED</Text><Text style={styles.cameraOffSub}>Enable in Settings for Auto-Count</Text></View>
          )}
        </View>
      )}
      <ScrollView style={styles.exerciseList} contentContainerStyle={{paddingBottom:20}} showsVerticalScrollIndicator={false}>
        {Object.entries(quest.exercises).map(([key, target]: [string, any]) => {
          const def = quest.customExercises?.[key]||EXERCISES[key]||{name:key,iconName:'help',iconLib:'Ionicons'};
          const count = counts[key]||0; const completed = isCompleted(key);
          return (
            <TouchableOpacity key={key} style={[styles.exerciseCard,completed&&styles.exerciseCardDone,activeExercise===key&&styles.exerciseCardActive]} onPress={() => setActiveExercise(key)}>
              <View style={styles.exHeaderRow}>
                <View style={styles.exIcon}><SoloIcon name={def.iconName} lib={def.iconLib} size={28} color={COLORS.blue}/></View>
                <View style={{flex:1}}><Text style={styles.exName}>{def.name}</Text><View style={styles.progressBarBg}><View style={[styles.progressBarFill,{width:`${Math.min((count/target)*100,100)}%`}]}/></View></View>
                <Text style={styles.countTextLarge}>{count}/{target}</Text>
              </View>
              <View style={styles.seriesControls}>
                <TouchableOpacity style={styles.seriesBtnSmall} onPress={() => handleDecrease(key)} disabled={count===0}><Ionicons name="remove" size={16} color={COLORS.white}/></TouchableOpacity>
                <TextInput style={styles.seriesInput} placeholder="#" placeholderTextColor={COLORS.textDark} keyboardType="numeric" value={manualInputs[key]||''} onChangeText={(t) => setManualInputs({...manualInputs,[key]:t})}/>
                <TouchableOpacity style={styles.seriesBtn} onPress={() => handleManualAdd(key,target)} disabled={completed}><Text style={styles.seriesBtnText}>ADD SET</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.checkBtn,completed?styles.checkBtnDone:{}]} onPress={() => setCounts({...counts,[key]:target})}><Ionicons name="checkmark" size={18} color={COLORS.white}/></TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={styles.checkAllBtn} onPress={handleCheckAll}><Text style={styles.checkAllText}>COMPLETE ALL EXERCISES</Text></TouchableOpacity>
        {allCompleted&&(<TouchableOpacity style={styles.completeBtn} onPress={() => onComplete(counts,workoutSec)}><Text style={styles.completeBtnText}>COMPLETE DUNGEON</Text></TouchableOpacity>)}
      </ScrollView>
    </View>
  );
}

function CustomProgramsScreen({ userData, customPrograms, setCustomPrograms, onBack, onStartProgram, showAlert }: any) {
  const [modalVisible, setModalVisible] = useState(false);
  const [newProgName, setNewProgName] = useState(''); const [editingId, setEditingId] = useState<string|null>(null);
  const [selectedEx, setSelectedEx] = useState<{[key:string]:number}>({}); const [customList, setCustomList] = useState<Array<{id:string,name:string,reps:number}>>([]); const [customExName, setCustomExName] = useState(''); const [customExCount, setCustomExCount] = useState('10'); const [schedule, setSchedule] = useState<string[]>([]);
  const toggleExercise = (key: string) => { const next={...selectedEx}; if(next[key]) delete next[key]; else next[key]=10; setSelectedEx(next); };
  const updateReps = (key: string, val: string) => { setSelectedEx({...selectedEx,[key]:parseInt(val)||0}); };
  const addCustomExercise = () => { if(!customExName) { showAlert("Error","Enter name"); return; } const newEx={id:`cust_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,name:customExName,reps:parseInt(customExCount)||10}; setCustomList([...customList,newEx]); setCustomExName(''); setCustomExCount('10'); };
  const removeCustomExercise = (id: string) => { setCustomList(customList.filter(item=>item.id!==id)); };
  const toggleDay = (day: string) => { if(schedule.includes(day)) setSchedule(schedule.filter(d=>d!==day)); else setSchedule([...schedule,day]); };
  const openCreateModal = () => { setNewProgName(''); setEditingId(null); setSelectedEx({}); setCustomList([]); setSchedule([]); setModalVisible(true); };
  const openEditModal = (prog: CustomProgram) => { setNewProgName(prog.name); setEditingId(prog.id); setSchedule(prog.schedule||[]); const stdEx: {[key:string]:number}={}; const cList: Array<{id:string,name:string,reps:number}>=[];  Object.entries(prog.exercises).forEach(([key,reps])=>{ if(EXERCISES[key]) stdEx[key]=reps as number; else if(prog.customExercises&&prog.customExercises[key]) cList.push({id:key,name:prog.customExercises[key].name,reps:reps as number}); }); setSelectedEx(stdEx); setCustomList(cList); setModalVisible(true); };

  const saveProgram = async () => {
    if(!newProgName) { showAlert("Error","Name required"); return; }
    let customDefs: ExerciseConfig={}; let finalExercises={...selectedEx};
    customList.forEach(item=>{customDefs[item.id]={name:item.name,iconName:'star',iconLib:'Ionicons',custom:true,type:'reps'};finalExercises[item.id]=item.reps;});
    const newProg: CustomProgram={id:editingId?editingId:Date.now().toString(),name:newProgName,exercises:finalExercises,customExercises:customDefs,schedule,createdAt:new Date().toISOString()};
    await dbSaveProgram(newProg);
    let updated; if(editingId) updated=customPrograms.map((p:any)=>p.id===editingId?newProg:p); else updated=[...customPrograms,newProg];
    setCustomPrograms(updated); setModalVisible(false);
  };

  const deleteProgram = async (id: string) => {
    await dbDeleteProgram(id);
    setCustomPrograms(customPrograms.filter((p:any)=>p.id!==id));
  };

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>CUSTOM PROGRAMS</Text><TouchableOpacity onPress={openCreateModal}><Ionicons name="add-circle" size={30} color={COLORS.blue}/></TouchableOpacity></View>
      <ScrollView style={{padding:20}} showsVerticalScrollIndicator={false}>
        {customPrograms.map((p:any) => (
          <View key={p.id} style={styles.programCard}>
            <View style={{flex:1}}><Text style={styles.progTitle}>{p.name}</Text><Text style={styles.progSub}>{Object.keys(p.exercises).length} Exercises</Text>{p.schedule&&p.schedule.length>0&&<Text style={{color:COLORS.gold,fontSize:10}}>Scheduled: {p.schedule.join(', ')}</Text>}</View>
            <TouchableOpacity style={styles.startBtnSmall} onPress={() => onStartProgram({title:p.name,difficulty:1,exercises:p.exercises,rewards:{xp:100,title:'Custom'},customExercises:p.customExercises,isDaily:false})}><Text style={styles.btnTextSmall}>START</Text></TouchableOpacity>
            <TouchableOpacity style={styles.editProgBtn} onPress={() => openEditModal(p)}><Ionicons name="create-outline" size={20} color={COLORS.white}/></TouchableOpacity>
            <TouchableOpacity style={styles.deleteProgBtn} onPress={() => deleteProgram(p.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger}/></TouchableOpacity>
          </View>
        ))}
      </ScrollView>
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.createModal}>
            <Text style={styles.modalTitle}>{editingId?'EDIT PROGRAM':'NEW PROGRAM'}</Text>
            <TextInput style={styles.input} placeholder="Program Name" placeholderTextColor={COLORS.textDark} value={newProgName} onChangeText={setNewProgName}/>
            <Text style={[styles.label,{marginTop:10}]}>Schedule as Daily Quest:</Text>
            <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:10}}>{WEEK_DAYS.map(day=>(<TouchableOpacity key={day} onPress={()=>toggleDay(day)} style={[styles.dayBtn,schedule.includes(day)&&styles.dayBtnActive]}><Text style={[styles.dayBtnText,schedule.includes(day)&&{color:COLORS.white}]}>{day.charAt(0)}</Text></TouchableOpacity>))}</View>
            <ScrollView style={{height:200,marginVertical:10}} showsVerticalScrollIndicator={false}>
              {Object.entries(EXERCISES).map(([k,v])=>(<View key={k} style={styles.selectRowContainer}><Text style={styles.rowLabel}>{v.name}</Text><View style={{flexDirection:'row',alignItems:'center'}}>{selectedEx[k]?(<TextInput style={styles.repsInput} keyboardType="numeric" value={String(selectedEx[k])} onChangeText={(val)=>updateReps(k,val)}/>):null}<TouchableOpacity style={[styles.checkboxBtn,selectedEx[k]?styles.checkboxActive:{}]} onPress={()=>toggleExercise(k)}><Ionicons name={selectedEx[k]?"remove":"add"} size={20} color={selectedEx[k]?COLORS.white:COLORS.blue}/></TouchableOpacity></View></View>))}
              {customList.length>0&&<Text style={[styles.label,{marginTop:15}]}>Added Custom:</Text>}
              {customList.map(item=>(<View key={item.id} style={styles.selectRowContainer}><View style={{flex:1}}><Text style={styles.rowLabel}>{item.name} ({item.reps} reps)</Text></View><TouchableOpacity style={styles.deleteBtn} onPress={()=>removeCustomExercise(item.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger}/></TouchableOpacity></View>))}
            </ScrollView>
            <View style={{borderTopWidth:1,borderTopColor:COLORS.accent,paddingTop:10}}>
              <Text style={styles.label}>Add Custom Exercise:</Text>
              <View style={styles.row}>
                <TextInput style={[styles.input,{flex:2,marginRight:5}]} placeholder="Name" placeholderTextColor={COLORS.textDark} value={customExName} onChangeText={setCustomExName}/>
                <TextInput style={[styles.input,{flex:1,marginRight:5}]} keyboardType="numeric" placeholder="Reps" placeholderTextColor={COLORS.textDark} value={customExCount} onChangeText={setCustomExCount}/>
                <TouchableOpacity style={styles.addCustomBtn} onPress={addCustomExercise}><Ionicons name="add" size={24} color={COLORS.white}/></TouchableOpacity>
              </View>
            </View>
            <View style={[styles.row,{marginTop:10}]}><TouchableOpacity style={styles.cancelBtn} onPress={()=>setModalVisible(false)}><Text style={styles.btnText}>CANCEL</Text></TouchableOpacity><TouchableOpacity style={styles.saveBtn} onPress={saveProgram}><Text style={styles.btnText}>SAVE</Text></TouchableOpacity></View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function StatsScreen({ userData, onBack }: any) {
  const [data, setData] = useState<number[]>([0]);
  useEffect(() => {
    dbGetHistory().then(history => {
      if(history.length > 0) {
        const grouped: {[key:string]:number}={};
        history.forEach((entry: TrainingHistory) => { const dateKey=entry.date.split('T')[0]; grouped[dateKey]=(grouped[dateKey]||0)+entry.xpGained; });
        const sortedKeys=Object.keys(grouped).sort(); const xpData=sortedKeys.map(k=>grouped[k]);
        if(xpData.length>0) setData(xpData.slice(-6)); else setData([0]);
      }
    });
  }, []);
  return (
    <ScrollView style={styles.screenContainer} showsVerticalScrollIndicator={false}>
      <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>STATISTICS</Text><View style={{width:24}}/></View>
      <View style={{padding:20}}>
        <Text style={styles.sectionTitle}>XP GAIN HISTORY</Text>
        <LineChart data={{labels:["1","2","3","4","5","6"],datasets:[{data}]}} width={width-40} height={220} yAxisLabel="" yAxisSuffix=" XP" chartConfig={{backgroundColor:COLORS.secondary,backgroundGradientFrom:COLORS.secondary,backgroundGradientTo:COLORS.accent,decimalPlaces:0,color:(opacity=1)=>`rgba(59,130,246,${opacity})`,labelColor:(opacity=1)=>`rgba(255,255,255,${opacity})`,style:{borderRadius:16},propsForDots:{r:"6",strokeWidth:"2",stroke:COLORS.glow}}} style={{marginVertical:8,borderRadius:16}} bezier/>
        <View style={styles.statBoxLarge}><Text style={styles.bigStat}>{userData.totalWorkouts}</Text><Text style={styles.bigStatLbl}>TOTAL DUNGEONS CLEARED</Text></View>
      </View>
    </ScrollView>
  );
}

function QuestScreen({ userData, customPrograms, onBack, onStartTraining }: any) {
  const getDailyQuest = (): Quest => {
    const todayDay = getDayString(new Date()); const scheduledProg = customPrograms.find((p: CustomProgram) => p.schedule&&p.schedule.includes(todayDay));
    if (scheduledProg) return { title:`DAILY: ${scheduledProg.name.toUpperCase()}`, difficulty:Math.floor(userData.level/5)+1, exercises:scheduledProg.exercises, customExercises:scheduledProg.customExercises, rewards:{xp:userData.level*100,title:'Hunter'}, isDaily:true };
    const level=userData.level; let exercises: {[key:string]:number}={}; let title="DAILY QUEST"; let rewardXP=level*100;
    if (userData.goal==='speed_strength') { title="ASSASSIN TRAINING"; exercises={clapPushups:Math.ceil(level*5),jumpSquats:Math.ceil(level*10),situps:Math.ceil(level*10),running:Math.min(1+(level*0.2),5)}; }
    else if (userData.goal==='weight_loss') { title="ENDURANCE TRIAL"; exercises={squats:level*15,situps:level*15,burpees:level*5,running:Math.min(2+(level*0.5),10)}; }
    else { title="STRENGTH TRAINING"; exercises={pushups:level*10,squats:level*10,situps:level*10,pullups:Math.ceil(level*2)}; }
    return { title, difficulty:Math.floor(level/5)+1, exercises, rewards:{xp:rewardXP,title:'Hunter'}, isDaily:true };
  };
  const dailyQuest = getDailyQuest(); const [expanded, setExpanded] = useState(false);
  const MAX_PREVIEW = 14; const exerciseEntries = Object.entries(dailyQuest.exercises); const hasMore = exerciseEntries.length>MAX_PREVIEW; const visibleExercises = expanded?exerciseEntries:exerciseEntries.slice(0,MAX_PREVIEW);
  const isCompleted = userData.lastDailyQuestCompleted===getISODate(new Date());
  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>QUEST INFO</Text><View style={{width:24}}/></View>
      <ScrollView style={{flex:1}} contentContainerStyle={{paddingBottom:10}} showsVerticalScrollIndicator={false}>
        <View style={styles.questPaperDark}>
          <Text style={styles.questTitleDark}>{dailyQuest.title}</Text>
          <Text style={styles.difficulty}>Rank: {'★'.repeat(dailyQuest.difficulty)}</Text>
          <View style={styles.divider}/>
          <Text style={styles.objTitleDark}>OBJECTIVES:</Text>
          {visibleExercises.map(([k,v]) => (<View key={k} style={[styles.objRow,{marginTop:5}]}><View style={{flexDirection:'row',alignItems:'center'}}><View style={{width:6,height:6,backgroundColor:COLORS.blue,marginRight:8}}/><Text style={styles.objTextDark}>{(dailyQuest.customExercises?.[k]?.name)||EXERCISES[k]?.name||k}</Text></View><Text style={styles.objValDark}>{String(v)}{EXERCISES[k]?.type==='distance'?' km':''}</Text></View>))}
          {hasMore&&(<TouchableOpacity onPress={()=>setExpanded(!expanded)} style={styles.expandBtn}><Text style={styles.expandBtnText}>{expanded?'▲  SHOW LESS':`▼  +${exerciseEntries.length-MAX_PREVIEW} MORE OBJECTIVES`}</Text></TouchableOpacity>)}
          <View style={styles.divider}/>
          <Text style={styles.rewardTitleDark}>REWARDS:</Text>
          <Text style={styles.rewardText}>+ {dailyQuest.rewards.xp} XP {isCompleted&&<Text style={{color:COLORS.gold}}>(REPEAT FOR BONUS XP)</Text>}</Text>
        </View>
      </ScrollView>
      <View style={{paddingHorizontal:20,paddingTop:10,paddingBottom:10,borderTopWidth:1,borderTopColor:COLORS.accent,backgroundColor:COLORS.primary}}>
        <TouchableOpacity style={[styles.acceptBtn,{marginBottom:0}]} onPress={() => onStartTraining(dailyQuest)}><Text style={styles.acceptBtnText}>{isCompleted?'REPEAT QUEST (+XP)':'ACCEPT QUEST'}</Text></TouchableOpacity>
      </View>
    </View>
  );
}

function SettingsScreen({ userData, onSave, onBack, showAlert, onImportDone }: any) {
  const [camEnabled, setCamEnabled] = useState(userData.cameraEnabled);
  const [name, setName] = useState(userData.name);
  const [image, setImage] = useState(userData.profileImage);
  const [busy, setBusy] = useState<'export'|'import'|null>(null);
  const pickImage = async () => { let result = await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Images,allowsEditing:true,aspect:[1,1],quality:0.5}); if(!result.canceled) setImage(result.assets[0].uri); };
  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>SYSTEM SETTINGS</Text><View style={{width:24}}/></View>
      <ScrollView style={{padding:20}} showsVerticalScrollIndicator={false}>
        <View style={{alignItems:'center',marginBottom:20}}>
          <TouchableOpacity onPress={pickImage}><Image source={image?{uri:image}:{uri:'https://via.placeholder.com/150'}} style={styles.settingsAvatar}/><View style={styles.editIconBadge}><Ionicons name="camera" size={14} color={COLORS.white}/></View></TouchableOpacity>
          <Text style={[styles.label,{marginTop:10}]}>EDIT HUNTER NAME</Text><TextInput style={[styles.input,{textAlign:'center',width:'80%'}]} value={name} onChangeText={setName} placeholder="Hunter Name" placeholderTextColor={COLORS.textDark}/>
        </View>
        <View style={styles.divider}/>
        <View style={styles.settingRow}><Text style={styles.settingText}>Enable Pose Detection (Camera)</Text><TouchableOpacity onPress={()=>setCamEnabled(!camEnabled)}><Ionicons name={camEnabled?"checkbox":"square-outline"} size={28} color={COLORS.blue}/></TouchableOpacity></View>
        <View style={styles.divider}/>
        <Text style={[styles.label,{marginTop:15,marginBottom:10}]}>DATA MANAGEMENT</Text>
        <View style={{flexDirection:'row',gap:10,marginBottom:10}}>
          <TouchableOpacity style={[styles.mainButton,{flex:1,marginTop:0,backgroundColor:COLORS.accent,opacity:busy?0.5:1}]} onPress={() => { if(busy) return; setBusy('export'); exportDataZip((t,m)=>showAlert(t,m)).finally(()=>setBusy(null)); }} disabled={!!busy}>
            <Ionicons name="cloud-upload-outline" size={18} color={COLORS.text}/><Text style={[styles.mainButtonText,{color:COLORS.text,fontSize:13}]}>{busy==='export'?'EXPORTING...':'EXPORT ZIP'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.mainButton,{flex:1,marginTop:0,backgroundColor:COLORS.accent,opacity:busy?0.5:1}]} onPress={() => { if(busy) return; setBusy('import'); importDataZip((t,m)=>showAlert(t,m),onImportDone).finally(()=>setBusy(null)); }} disabled={!!busy}>
            <Ionicons name="cloud-download-outline" size={18} color={COLORS.text}/><Text style={[styles.mainButtonText,{color:COLORS.text,fontSize:13}]}>{busy==='import'?'IMPORTING...':'IMPORT ZIP'}</Text>
          </TouchableOpacity>
        </View>
        <Text style={{color:COLORS.textDark,fontSize:11,textAlign:'center',marginBottom:20}}>Export saves all your data. Import replaces all current data.</Text>
        <TouchableOpacity style={styles.settingsSaveBtn} onPress={() => onSave({...userData,cameraEnabled:camEnabled,name,profileImage:image})}><Text style={styles.settingsSaveBtnText}>SAVE CHANGES</Text></TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  expandBtn: { marginTop:10, alignItems:'center', paddingVertical:8, borderWidth:1, borderColor:COLORS.blue, borderRadius:6, borderStyle:'dashed' },
  expandBtnText: { color:COLORS.blue, fontSize:11, fontWeight:'bold', letterSpacing:1.5 },
  container: { flex:1, backgroundColor:COLORS.primary },
  screenContainer: { flex:1, backgroundColor:COLORS.primary },
  centerContainer: { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:COLORS.primary },
  loadingTitle: { fontSize:32, fontWeight:'900', color:COLORS.blue, letterSpacing:4 },
  loadingSubtitle: { color:COLORS.textDark, marginTop:10, letterSpacing:2 },
  header: { flexDirection:'row', justifyContent:'space-between', padding:20, alignItems:'center', borderBottomWidth:1, borderBottomColor:COLORS.accent },
  headerTitle: { color:COLORS.text, fontSize:18, fontWeight:'bold', letterSpacing:1.5 },
  workoutTimerBanner: { flexDirection:'row', alignItems:'center', justifyContent:'center', paddingVertical:10, backgroundColor:COLORS.secondary, borderBottomWidth:1, borderBottomColor:COLORS.gold },
  workoutTimerText: { color:COLORS.gold, fontSize:26, fontWeight:'900', letterSpacing:2, marginLeft:8 },
  timerBadge: { flexDirection:'row', alignItems:'center', backgroundColor:COLORS.secondary, paddingVertical:4, paddingHorizontal:10, borderRadius:12, borderWidth:1, borderColor:COLORS.gold },
  timerValue: { color:COLORS.gold, fontWeight:'bold', marginLeft:5, fontSize:12 },
  avatarPicker: { alignSelf:'center', marginVertical:20 },
  avatarPlaceholder: { width:100, height:100, borderRadius:50, backgroundColor:COLORS.accent, justifyContent:'center', alignItems:'center', borderStyle:'dashed', borderWidth:1, borderColor:COLORS.textDark },
  avatarImage: { width:100, height:100, borderRadius:50 },
  avatarText: { fontSize:10, color:COLORS.textDark, marginTop:5 },
  formGroup: { marginBottom:15 },
  row: { flexDirection:'row', justifyContent:'space-between' },
  label: { color:COLORS.blue, fontSize:12, marginBottom:5, fontWeight:'bold' },
  input: { backgroundColor:COLORS.secondary, color:COLORS.text, padding:15, borderRadius:8, borderWidth:1, borderColor:COLORS.accent },
  genderContainer: { flexDirection:'row', justifyContent:'space-between' },
  genderBtn: { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', padding:15, backgroundColor:COLORS.secondary, borderRadius:8, borderWidth:1, borderColor:COLORS.accent, marginHorizontal:5 },
  genderBtnActive: { backgroundColor:COLORS.blue, borderColor:COLORS.glow },
  genderText: { color:COLORS.blue, fontWeight:'bold', marginLeft:8 },
  genderTextActive: { color:COLORS.white, fontWeight:'bold', marginLeft:8 },
  goalBtn: { flexDirection:'row', alignItems:'center', padding:15, backgroundColor:COLORS.secondary, borderRadius:8, borderWidth:1, borderColor:COLORS.accent, marginBottom:8 },
  goalBtnActive: { backgroundColor:COLORS.blue, borderColor:COLORS.glow },
  goalText: { color:COLORS.blue, fontWeight:'bold', marginLeft:15 },
  goalTextActive: { color:COLORS.white, fontWeight:'bold', marginLeft:15 },
  mainButton: { backgroundColor:COLORS.blue, padding:18, borderRadius:8, alignItems:'center', marginTop:20, flexDirection:'row', justifyContent:'center', gap:8 },
  mainButtonText: { color:COLORS.primary, fontWeight:'bold', fontSize:16, letterSpacing:2 },
  dashboardHeader: { padding:20, paddingTop:10 },
  profileRow: { flexDirection:'row', alignItems:'center' },
  profileImageSmall: { width:60, height:60, borderRadius:30, marginRight:15, borderWidth:2, borderColor:COLORS.blue },
  playerName: { color:COLORS.text, fontSize:22, fontWeight:'bold' },
  playerRank: { color:COLORS.glow, fontSize:12, letterSpacing:1 },
  systemWindow: { margin:20, padding:20, backgroundColor:COLORS.secondary, borderRadius:12, borderWidth:1, borderColor:COLORS.blue },
  systemHeader: { color:COLORS.text, textAlign:'center', fontWeight:'bold', marginBottom:15 },
  xpBarContainer: { height:6, backgroundColor:COLORS.accent, borderRadius:3, marginBottom:5 },
  xpBarFill: { height:'100%', backgroundColor:COLORS.blue, borderRadius:3 },
  xpText: { color:COLORS.textDark, fontSize:10, textAlign:'right', marginBottom:15 },
  statGrid: { flexDirection:'row', justifyContent:'space-around' },
  statItem: { alignItems:'center' },
  statVal: { color:COLORS.text, fontSize:18, fontWeight:'bold' },
  statLbl: { color:COLORS.textDark, fontSize:10 },
  menuGrid: { padding:20 },
  menuCardLarge: { backgroundColor:COLORS.accent, padding:20, borderRadius:12, alignItems:'center', marginBottom:15, borderWidth:1, borderColor:COLORS.gold },
  menuTitle: { color:COLORS.text, fontSize:18, fontWeight:'bold', marginTop:10 },
  menuSub: { color:COLORS.danger, fontSize:12 },
  menuRow: { flexDirection:'row', justifyContent:'space-between', marginBottom:15 },
  menuCardSmall: { backgroundColor:COLORS.secondary, width:'48%', padding:15, borderRadius:12, alignItems:'center', borderWidth:1, borderColor:COLORS.accent },
  menuTitleSmall: { color:COLORS.text, marginTop:5, fontSize:12 },
  playerMain: { alignItems:'center', padding:20 },
  albumArtPlaceholder: { width:140, height:140, backgroundColor:COLORS.secondary, borderRadius:12, justifyContent:'center', alignItems:'center', marginBottom:15, borderWidth:1, borderColor:COLORS.accent },
  albumArt: { width:140, height:140, borderRadius:12, marginBottom:15, borderWidth:1, borderColor:COLORS.accent },
  nowPlayingTitle: { color:COLORS.text, fontSize:18, fontWeight:'bold', marginBottom:10, textAlign:'center' },
  seekContainer: { flexDirection:'row', alignItems:'center', width:'100%', marginBottom:15 },
  timeText: { color:COLORS.textDark, fontSize:10, width:35, textAlign:'center' },
  playerControlsMain: { flexDirection:'row', alignItems:'center', justifyContent:'space-around', width:'80%' },
  playButtonLarge: { width:60, height:60, borderRadius:30, backgroundColor:COLORS.blue, justifyContent:'center', alignItems:'center' },
  ctrlBtn: { padding:10 },
  modeBtnHeader: { flexDirection:'row', alignItems:'center', backgroundColor:COLORS.secondary, padding:5, borderRadius:5, borderWidth:1, borderColor:COLORS.accent },
  playlistHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:20, marginTop:10 },
  sectionTitle: { color:COLORS.blue, fontWeight:'bold' },
  addBtn: { backgroundColor:COLORS.highlight, padding:5, borderRadius:4 },
  searchContainer: { flexDirection:'row', alignItems:'center', backgroundColor:COLORS.secondary, borderRadius:8, paddingHorizontal:10, paddingVertical:5, borderWidth:1, borderColor:COLORS.accent, marginTop:10 },
  searchInput: { flex:1, color:COLORS.text, marginLeft:10, paddingVertical:5 },
  playlistContainer: { padding:20 },
  trackRow: { flexDirection:'row', alignItems:'center', paddingVertical:12, borderBottomWidth:1, borderBottomColor:COLORS.accent, justifyContent:'space-between' },
  trackActive: { backgroundColor:COLORS.accent },
  trackInfoArea: { flexDirection:'row', alignItems:'center', flex:1 },
  trackIcon: { width:30 },
  trackName: { color:COLORS.textDark, flex:1, fontSize:14, marginLeft:5 },
  trackNameActive: { color:COLORS.white, fontWeight:'bold', textShadowColor:COLORS.glow, textShadowRadius:8 },
  deleteBtn: { padding:5 },
  miniPlayerContainer: { position:'relative', bottom:0, left:0, right:0, height:70, backgroundColor:COLORS.secondary, borderTopWidth:1, borderTopColor:COLORS.blue, zIndex:999 },
  miniProgressContainer: { height:2, backgroundColor:COLORS.accent, width:'100%' },
  miniProgressFill: { height:'100%', backgroundColor:COLORS.highlight },
  miniPlayerContent: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:15, flex:1 },
  miniInfo: { flexDirection:'row', alignItems:'center', flex:1, paddingRight:10 },
  miniArt: { width:40, height:40, borderRadius:4, marginRight:10 },
  miniTitle: { color:COLORS.white, fontWeight:'bold', fontSize:14 },
  miniTime: { color:COLORS.textDark, fontSize:10 },
  miniControls: { flexDirection:'row', alignItems:'center' },
  miniCtrlBtn: { marginHorizontal:8 },
  cameraContainer: { height:250, backgroundColor:'#000', overflow:'hidden' },
  camera: { flex:1 },
  cameraOverlay: { flex:1, justifyContent:'center', alignItems:'center' },
  detectionText: { color:COLORS.success, fontSize:10, position:'absolute', top:10, right:10, backgroundColor:'rgba(0,0,0,0.5)', padding:4 },
  poseBox: { width:200, height:300, borderWidth:2, borderColor:COLORS.glow, opacity:0.5 },
  camWarningBox: { backgroundColor:'rgba(239,68,68,0.8)', padding:10, borderRadius:5 },
  camWarningText: { color:COLORS.white, fontWeight:'bold' },
  poseInfoBox: { position:'absolute', bottom:10, left:10, right:10, backgroundColor:'rgba(0,0,0,0.6)', padding:10, borderRadius:5 },
  poseInfoText: { color:COLORS.success, fontWeight:'bold', fontSize:12 },
  poseInfoSub: { color:COLORS.textDark, fontSize:10 },
  cameraOff: { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:COLORS.secondary },
  cameraOffText: { color:COLORS.text, fontWeight:'bold', marginTop:10 },
  cameraOffSub: { color:COLORS.textDark, fontSize:10 },
  exerciseList: { flex:1, padding:20 },
  exerciseCard: { backgroundColor:COLORS.secondary, padding:15, marginBottom:10, borderRadius:8, borderWidth:1, borderColor:COLORS.accent },
  exerciseCardActive: { borderColor:COLORS.blue, backgroundColor:'#1e293b' },
  exerciseCardDone: { opacity:0.6, borderColor:COLORS.success },
  exHeaderRow: { flexDirection:'row', alignItems:'center', marginBottom:10 },
  exIcon: { width:40 },
  exName: { color:COLORS.text, fontWeight:'bold', marginBottom:5 },
  progressBarBg: { height:4, backgroundColor:COLORS.accent, borderRadius:2, width:'90%' },
  progressBarFill: { height:'100%', backgroundColor:COLORS.blue, borderRadius:2 },
  countTextLarge: { color:COLORS.white, fontSize:16, fontWeight:'bold' },
  seriesControls: { flexDirection:'row', alignItems:'center', marginTop:5, justifyContent:'flex-end' },
  seriesInput: { width:50, height:35, backgroundColor:COLORS.primary, color:COLORS.white, textAlign:'center', borderRadius:4, borderWidth:1, borderColor:COLORS.accent, marginHorizontal:5 },
  seriesBtn: { backgroundColor:COLORS.blue, paddingHorizontal:10, paddingVertical:8, borderRadius:4, marginHorizontal:5 },
  seriesBtnSmall: { backgroundColor:COLORS.accent, width:35, height:35, borderRadius:4, alignItems:'center', justifyContent:'center' },
  seriesBtnText: { color:COLORS.white, fontSize:10, fontWeight:'bold' },
  checkBtn: { width:35, height:35, borderRadius:17.5, borderWidth:1, borderColor:COLORS.textDark, alignItems:'center', justifyContent:'center', marginLeft:10 },
  checkBtnDone: { backgroundColor:COLORS.success, borderColor:COLORS.success },
  checkAllBtn: { marginVertical:10, padding:10, borderWidth:1, borderColor:COLORS.blue, borderRadius:8, alignItems:'center' },
  checkAllText: { color:COLORS.blue, fontSize:12, fontWeight:'bold', letterSpacing:1 },
  completeBtn: { backgroundColor:COLORS.blue, margin:20, padding:15, borderRadius:8, alignItems:'center' },
  completeBtnText: { color:COLORS.primary, fontWeight:'bold', letterSpacing:2 },
  programCard: { backgroundColor:COLORS.secondary, padding:15, borderRadius:8, marginBottom:15, flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  progTitle: { color:COLORS.text, fontSize:16, fontWeight:'bold' },
  progSub: { color:COLORS.textDark, fontSize:12 },
  startBtnSmall: { backgroundColor:COLORS.success, paddingHorizontal:12, paddingVertical:6, borderRadius:4, marginRight:10 },
  editProgBtn: { backgroundColor:COLORS.accent, paddingHorizontal:8, paddingVertical:6, borderRadius:4, marginRight:10 },
  deleteProgBtn: { padding:5 },
  btnTextSmall: { color:COLORS.primary, fontWeight:'bold', fontSize:10 },
  modalOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.8)', justifyContent:'center', padding:20 },
  createModal: { backgroundColor:COLORS.secondary, padding:20, borderRadius:12, borderWidth:1, borderColor:COLORS.blue },
  modalTitle: { color:COLORS.text, fontSize:18, fontWeight:'bold', textAlign:'center', marginBottom:15 },
  selectRowContainer: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:10, borderBottomWidth:1, borderBottomColor:COLORS.accent },
  rowLabel: { color:COLORS.textDark, fontSize:16 },
  repsInput: { backgroundColor:COLORS.primary, color:COLORS.white, width:50, padding:5, borderRadius:4, textAlign:'center', borderWidth:1, borderColor:COLORS.blue, marginRight:10 },
  checkboxBtn: { padding:5, borderRadius:4, borderWidth:1, borderColor:COLORS.blue },
  checkboxActive: { backgroundColor:COLORS.danger, borderColor:COLORS.danger },
  addCustomBtn: { backgroundColor:COLORS.blue, padding:10, borderRadius:4, justifyContent:'center', alignItems:'center' },
  cancelBtn: { flex:1, padding:15, alignItems:'center', marginRight:10 },
  saveBtn: { flex:1, backgroundColor:COLORS.blue, padding:15, alignItems:'center', borderRadius:6 },
  btnText: { color:COLORS.text, fontWeight:'bold' },
  settingsSaveBtn: { backgroundColor:COLORS.blue, padding:18, borderRadius:8, alignItems:'center', marginTop:30 },
  settingsSaveBtnText: { color:COLORS.white, fontWeight:'bold', fontSize:16, letterSpacing:1 },
  settingsAvatar: { width:120, height:120, borderRadius:60, borderWidth:2, borderColor:COLORS.blue, marginBottom:10 },
  editIconBadge: { position:'absolute', bottom:10, right:10, backgroundColor:COLORS.blue, width:30, height:30, borderRadius:15, justifyContent:'center', alignItems:'center', borderWidth:2, borderColor:COLORS.secondary },
  statBoxLarge: { backgroundColor:COLORS.accent, padding:20, alignItems:'center', borderRadius:12, marginTop:20 },
  bigStat: { color:COLORS.blue, fontSize:40, fontWeight:'bold' },
  bigStatLbl: { color:COLORS.textDark, fontSize:12, letterSpacing:2 },
  questPaperDark: { backgroundColor:COLORS.secondary, margin:20, padding:20, borderRadius:8, borderWidth:1, borderColor:COLORS.accent },
  questTitleDark: { color:COLORS.text, fontSize:20, fontWeight:'bold', textAlign:'center' },
  difficulty: { color:COLORS.gold, textAlign:'center', fontSize:12, marginBottom:10 },
  objTitleDark: { color:COLORS.blue, fontWeight:'bold', marginTop:10 },
  objRow: { flexDirection:'row', justifyContent:'space-between', marginTop:5 },
  objTextDark: { color:COLORS.text },
  objValDark: { color:COLORS.text, fontWeight:'bold' },
  divider: { height:1, backgroundColor:COLORS.accent, marginVertical:10 },
  rewardTitleDark: { color:COLORS.text, fontWeight:'bold' },
  rewardText: { color:COLORS.blue, fontWeight:'bold' },
  acceptBtn: { backgroundColor:COLORS.blue, margin:20, padding:15, borderRadius:8, alignItems:'center' },
  acceptBtnText: { color:COLORS.primary, fontWeight:'bold', letterSpacing:2 },
  settingRow: { flexDirection:'row', justifyContent:'space-between', paddingVertical:15, borderBottomWidth:1, borderBottomColor:COLORS.accent, alignItems:'center' },
  settingText: { color:COLORS.text, fontSize:16 },
  alertBox: { backgroundColor:COLORS.secondary, borderRadius:12, borderWidth:2, borderColor:COLORS.blue, padding:20, width:'100%' },
  alertTitle: { color:COLORS.blue, fontSize:18, fontWeight:'bold', textAlign:'center', letterSpacing:1 },
  alertMessage: { color:COLORS.text, textAlign:'center', marginVertical:15 },
  alertButtons: { flexDirection:'row', justifyContent:'center', marginTop:10 },
  alertButton: { paddingHorizontal:20, paddingVertical:10, borderRadius:6, minWidth:80, alignItems:'center', marginHorizontal:5 },
  alertButtonDefault: { backgroundColor:COLORS.blue },
  alertButtonDestructive: { backgroundColor:COLORS.danger },
  alertButtonCancel: { backgroundColor:COLORS.accent },
  alertButtonText: { color:COLORS.text, fontWeight:'bold', fontSize:12 },
  timerCircle: { width:120, height:120, borderRadius:60, borderWidth:4, borderColor:COLORS.blue, justifyContent:'center', alignItems:'center', marginVertical:30 },
  timerText: { fontSize:40, fontWeight:'bold', color:COLORS.white },
  dayBtn: { width:35, height:35, borderRadius:17.5, backgroundColor:COLORS.secondary, justifyContent:'center', alignItems:'center', borderWidth:1, borderColor:COLORS.accent },
  dayBtnActive: { backgroundColor:COLORS.blue, borderColor:COLORS.glow },
  dayBtnText: { color:COLORS.textDark, fontSize:12, fontWeight:'bold' },
  timerCtrlBtn: { flexDirection:'row', alignItems:'center', paddingHorizontal:20, paddingVertical:10, borderRadius:8, marginHorizontal:5 },
  timerCtrlText: { color:COLORS.white, fontWeight:'bold', marginLeft:6, fontSize:13, letterSpacing:1 },
  linkedSegment: { alignItems:'center', backgroundColor:COLORS.accent, borderRadius:8, paddingVertical:8, paddingHorizontal:14, marginHorizontal:2 },
  linkedLabel: { color:COLORS.textDark, fontSize:9, fontWeight:'bold', letterSpacing:1, marginBottom:2 },
  linkedValue: { color:COLORS.white, fontSize:28, fontWeight:'900' },
  linkedSep: { color:COLORS.blue, fontSize:28, fontWeight:'900', marginHorizontal:2, marginTop:8 },
  numpadBtn: { width:72, height:50, backgroundColor:COLORS.accent, borderRadius:8, justifyContent:'center', alignItems:'center', marginHorizontal:5, borderWidth:1, borderColor:COLORS.secondary },
  numpadText: { color:COLORS.white, fontSize:22, fontWeight:'bold' },
});








// import { FontAwesome5, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
// import AsyncStorage from "@react-native-async-storage/async-storage";
// import Slider from "@react-native-community/slider";
// import { Audio } from "expo-av";
// import { CameraView, useCameraPermissions } from "expo-camera";
// import * as DocumentPicker from "expo-document-picker";
// import * as ImagePicker from "expo-image-picker";
// import React, { useEffect, useRef, useState } from "react";
// import { Animated, AppState, BackHandler, Dimensions, Image, Modal, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, Vibration, View } from "react-native";
// import { LineChart } from "react-native-chart-kit";
// import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

// const { width } = Dimensions.get('window');

// type GoalType = 'muscle' | 'weight_loss' | 'speed_strength';
// interface UserData { name: string; level: number; sex: 'male' | 'female'; weight: number; height: number; goal: GoalType; xp: number; totalWorkouts: number; createdAt: string; lastDailyQuestCompleted?: string; cameraEnabled: boolean; profileImage?: string; assessmentStats?: { [key: string]: number }; }
// interface Exercise { name: string; iconName: string; iconLib: 'Ionicons' | 'MaterialCommunityIcons' | 'FontAwesome5'; type?: 'reps' | 'duration' | 'distance'; custom?: boolean; }
// interface ExerciseConfig { [key: string]: Exercise; }
// interface Quest { title: string; difficulty: number; exercises: { [key: string]: number }; rewards: { xp: number; title: string }; customExercises?: ExerciseConfig; isDaily?: boolean; }
// interface TrainingResult { [key: string]: number; }
// interface TrainingHistory { date: string; quest: Quest; results: TrainingResult; xpGained: number; durationSeconds?: number; }
// interface MusicTrack { id: string; title: string; path: any; isLocal: boolean; isFavorite: boolean; artwork?: string; }
// interface CustomProgram { id: string; name: string; exercises: { [key: string]: number }; customExercises?: ExerciseConfig; schedule: string[]; createdAt: string; }
// interface AlertButton { text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive'; }
// interface CustomAlertState { visible: boolean; title: string; message: string; buttons: AlertButton[]; }
// interface CustomTimer { id: string; label: string; seconds: number; }
// type PlaybackMode = 'loop_all' | 'play_all' | 'loop_one' | 'play_one';

// const COLORS = { primary: '#050714', secondary: '#0F172A', accent: '#1E293B', highlight: '#2563EB', blue: '#3B82F6', lightBlue: '#60A5FA', purple: '#7C3AED', danger: '#EF4444', success: '#10B981', text: '#F8FAFC', textDark: '#94A3B8', glow: '#0EA5E9', gold: '#F59E0B', white: '#FFFFFF' };
// const XP_PER_LEVEL_BASE = 600;
// const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// const EXERCISES: ExerciseConfig = {
//   squats: { name: 'Squats', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   pushups: { name: 'Push-ups', iconName: 'human-handsup', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   situps: { name: 'Sit-ups', iconName: 'dumbbell', iconLib: 'FontAwesome5', type: 'reps' },
//   pullups: { name: 'Pull-ups', iconName: 'human-male-height', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   bicepCurls: { name: 'Bicep Curls', iconName: 'arm-flex', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   lunges: { name: 'Lunges', iconName: 'run', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   plank: { name: 'Plank (sec)', iconName: 'timer', iconLib: 'Ionicons', type: 'duration' },
//   running: { name: 'Running (km)', iconName: 'run-fast', iconLib: 'MaterialCommunityIcons', type: 'distance' },
//   clapPushups: { name: 'Clap Push-ups', iconName: 'flash', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   jumpSquats: { name: 'Jump Squats', iconName: 'arrow-up-bold-circle', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   burpees: { name: 'Burpees', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
// };

// class PoseCalculator {
//   static calculateAngle(a: {x:number,y:number}, b: {x:number,y:number}, c: {x:number,y:number}) { const radians = Math.atan2(c.y-b.y,c.x-b.x)-Math.atan2(a.y-b.y,a.x-b.x); let angle = Math.abs(radians*180.0/Math.PI); if(angle>180.0) angle=360-angle; return angle; }
//   static detectSquat(landmarks: any): { angle: number } { return { angle: 0 }; }
//   static isSupported(exerciseKey: string): boolean { return ['squats','pushups','situps','bicepCurls','lifting'].includes(exerciseKey); }
// }

// const SYSTEM_SOUND = require('../assets/audio/solo_leveling_system.mp3');
// const DEFAULT_OST = require('../assets/audio/ost.mp3');
// const getDayString = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'short' });
// const getISODate = (date: Date) => date.toISOString().split('T')[0];
// const formatTime = (seconds: number) => { const m = Math.floor(seconds/60); const s = Math.floor(seconds%60); return `${m}:${s<10?'0':''}${s}`; };
// const pad2 = (n: number) => n < 10 ? `0${n}` : `${n}`;
// const pad3 = (n: number) => n < 10 ? `00${n}` : n < 100 ? `0${n}` : `${n}`;

// // Stopwatch display: ms precision, auto-expands to hours/days
// const formatStopwatch = (totalMs: number) => {
//   const ms = totalMs % 1000; const totalSec = Math.floor(totalMs/1000); const sec = totalSec%60;
//   const totalMin = Math.floor(totalSec/60); const min = totalMin%60;
//   const totalHr = Math.floor(totalMin/60); const hr = totalHr%24; const days = Math.floor(totalHr/24);
//   if (days > 0) return `${days}d ${pad2(hr)}:${pad2(min)}:${pad2(sec)}.${pad3(ms)}`;
//   if (hr > 0) return `${pad2(hr)}:${pad2(min)}:${pad2(sec)}.${pad3(ms)}`;
//   return `${pad2(min)}:${pad2(sec)}.${pad3(ms)}`;
// };

// // Countdown display with hours support
// const formatCountdown = (totalSec: number) => {
//   const sec = totalSec%60; const totalMin = Math.floor(totalSec/60); const min = totalMin%60;
//   const totalHr = Math.floor(totalMin/60); const hr = totalHr%24; const days = Math.floor(totalHr/24);
//   if (days > 0) return `${days}d ${pad2(hr)}:${pad2(min)}:${pad2(sec)}`;
//   if (hr > 0) return `${pad2(hr)}:${pad2(min)}:${pad2(sec)}`;
//   return `${pad2(min)}:${pad2(sec)}`;
// };

// // Linked digit parser: 6 slots [H,H,M,M,S,S] right-to-left entry like a calculator
// const parseLinkedDigits = (digits: string[]): { hours: number; minutes: number; seconds: number } => {
//   const h = parseInt(digits.slice(0,2).join(''))||0;
//   const m = parseInt(digits.slice(2,4).join(''))||0;
//   const s = parseInt(digits.slice(4,6).join(''))||0;
//   return { hours: Math.min(h,99), minutes: Math.min(m,59), seconds: Math.min(s,59) };
// };

// const SoloIcon = ({ name, lib, size = 24, color = COLORS.text }: { name: string, lib: string, size?: number, color?: string }) => {
//   if (lib==='Ionicons') return <Ionicons name={name as any} size={size} color={color} />;
//   if (lib==='MaterialCommunityIcons') return <MaterialCommunityIcons name={name as any} size={size} color={color} />;
//   if (lib==='FontAwesome5') return <FontAwesome5 name={name as any} size={size} color={color} />;
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
//               <TouchableOpacity key={index} style={[styles.alertButton, btn.style==='destructive'?styles.alertButtonDestructive:btn.style==='cancel'?styles.alertButtonCancel:styles.alertButtonDefault]} onPress={() => { if(btn.onPress) btn.onPress(); onClose(); }}>
//                 <Text style={styles.alertButtonText}>{btn.text}</Text>
//               </TouchableOpacity>
//             ))}
//           </View>
//         </View>
//       </View>
//     </Modal>
//   );
// };

// export default function SoloLevelingFitnessTracker(): JSX.Element {
//   const [screen, setScreenState] = useState<string>('loading');
//   const [userData, setUserData] = useState<UserData | null>(null);
//   const [customPrograms, setCustomPrograms] = useState<CustomProgram[]>([]);
//   const [alertState, setAlertState] = useState<CustomAlertState>({ visible: false, title: '', message: '', buttons: [] });
//   const [playlist, setPlaylist] = useState<MusicTrack[]>([]);
//   const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
//   const [sound, setSound] = useState<Audio.Sound | null>(null);
//   const [isPlaying, setIsPlaying] = useState(false);
//   const [musicLoading, setMusicLoading] = useState(false);
//   const [position, setPosition] = useState(0);
//   const [duration, setDuration] = useState(0);
//   const [isMuted, setIsMuted] = useState(false);
//   const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('loop_all');
//   const playlistRef = useRef<MusicTrack[]>([]); const currentTrackRef = useRef<MusicTrack | null>(null); const playbackModeRef = useRef<PlaybackMode>('loop_all');
//   useEffect(() => { playlistRef.current = playlist; }, [playlist]);
//   useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
//   useEffect(() => { playbackModeRef.current = playbackMode; }, [playbackMode]);
//   const [systemSoundObj, setSystemSoundObj] = useState<Audio.Sound | null>(null);
//   const [currentQuest, setCurrentQuest] = useState<Quest | null>(null);
//   const [isTraining, setIsTraining] = useState<boolean>(false);

//   const playSystemSound = async () => {
//     try {
//       if (systemSoundObj) await systemSoundObj.unloadAsync();
//       if (sound && isPlaying) await sound.setVolumeAsync(0.1);
//       const { sound: newSysSound } = await Audio.Sound.createAsync(SYSTEM_SOUND);
//       setSystemSoundObj(newSysSound);
//       await newSysSound.playAsync();
//       newSysSound.setOnPlaybackStatusUpdate(async (status) => { if(status.isLoaded&&status.didJustFinish) { await newSysSound.unloadAsync(); setSystemSoundObj(null); if(sound&&isPlaying) await sound.setVolumeAsync(1.0); } });
//     } catch (error) { console.log('System sound error', error); }
//   };

//   const navigateTo = (newScreen: string) => { if(newScreen!==screen) { playSystemSound(); setScreenState(newScreen); } };
//   const showAlert = (title: string, message: string, buttons: AlertButton[] = [{ text: 'OK' }]) => { setAlertState({ visible: true, title, message, buttons }); };
//   const closeAlert = () => { setAlertState(prev => ({ ...prev, visible: false })); };

//   useEffect(() => {
//     const backAction = () => {
//       if (systemSoundObj) { try { systemSoundObj.stopAsync(); systemSoundObj.unloadAsync(); setSystemSoundObj(null); } catch(e) {} }
//       if (screen==='dashboard'||screen==='loading'||screen==='setup') return false;
//       if (screen==='training') { showAlert("Abort Mission?","Stop training?",[{text:"Cancel",style:"cancel"},{text:"Quit",style:"destructive",onPress:()=>navigateTo('dashboard')}]); return true; }
//       navigateTo('dashboard'); return true;
//     };
//     const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
//     return () => backHandler.remove();
//   }, [screen, systemSoundObj]);

//   useEffect(() => {
//     async function init() {
//       try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false, staysActiveInBackground: true, playsInSilentModeIOS: true, shouldDuckAndroid: true, playThroughEarpieceAndroid: false }); } catch(e) { console.warn("Audio Mode Config Error:",e); }
//       try {
//         const stored = await AsyncStorage.getItem('musicPlaylist');
//         const defaultTrack: MusicTrack = { id: 'default_ost', title: 'System Soundtrack (Default)', path: DEFAULT_OST, isLocal: true, isFavorite: true };
//         let tracks: MusicTrack[] = [defaultTrack];
//         if (stored) { const parsed = JSON.parse(stored); tracks = [...tracks, ...parsed.filter((t: MusicTrack) => t.id!=='default_ost')]; }
//         setPlaylist(tracks);
//       } catch(e) { console.error("Audio Init Error",e); }
//       playSystemSound();
//       const progData = await AsyncStorage.getItem('customPrograms');
//       const loadedPrograms: CustomProgram[] = progData ? JSON.parse(progData) : [];
//       setCustomPrograms(loadedPrograms);
//       const data = await AsyncStorage.getItem('userData');
//       if (data) { let user: UserData = JSON.parse(data); user = await checkPenalties(user, loadedPrograms); setUserData(user); setScreenState('dashboard'); } else { setScreenState('setup'); }
//     }
//     init();
//     return () => { if(sound) sound.unloadAsync(); if(systemSoundObj) systemSoundObj.unloadAsync(); };
//   }, []);

//   const checkPenalties = async (user: UserData, programs: CustomProgram[]): Promise<UserData> => {
//     if (!user.lastDailyQuestCompleted) { const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1); user.lastDailyQuestCompleted = getISODate(yesterday); await AsyncStorage.setItem('userData', JSON.stringify(user)); return user; }
//     const lastDate = new Date(user.lastDailyQuestCompleted); const today = new Date(); const todayStr = getISODate(today);
//     if (user.lastDailyQuestCompleted===todayStr) return user;
//     let penaltyXP = 0; let missedDays = 0;
//     const checkDate = new Date(lastDate); checkDate.setDate(checkDate.getDate()+1);
//     const historyData = await AsyncStorage.getItem('trainingHistory'); const history: TrainingHistory[] = historyData ? JSON.parse(historyData) : []; let historyChanged = false;
//     while (getISODate(checkDate)<todayStr) {
//       const dailyPenaltyAmount = user.level*100; penaltyXP += dailyPenaltyAmount; missedDays++;
//       history.push({ date: checkDate.toISOString(), quest: { title:"PENALTY: MISSED QUEST", difficulty:0, exercises:{}, rewards:{xp:0,title:'None'} }, results:{}, xpGained:-dailyPenaltyAmount, durationSeconds:0 });
//       historyChanged = true; checkDate.setDate(checkDate.getDate()+1);
//     }
//     if (penaltyXP>0) {
//       let newXP = user.xp-penaltyXP; let newLevel = user.level;
//       while (newXP<0) { if(newLevel>1) { newLevel--; newXP = newLevel*XP_PER_LEVEL_BASE+newXP; } else { newXP=0; break; } }
//       user.xp = newXP; user.level = newLevel;
//       const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1); user.lastDailyQuestCompleted = getISODate(yesterday);
//       showAlert("PENALTY SYSTEM",`You failed to complete daily quests for ${missedDays} day(s).\n\nPUNISHMENT: -${penaltyXP} XP.`);
//       await AsyncStorage.setItem('userData', JSON.stringify(user));
//       if (historyChanged) await AsyncStorage.setItem('trainingHistory', JSON.stringify(history));
//     }
//     return user;
//   };

//   useEffect(() => {
//     let interval: NodeJS.Timeout;
//     if (sound&&isPlaying) { interval = setInterval(async () => { try { const status = await sound.getStatusAsync(); if(status.isLoaded) { setPosition(status.positionMillis/1000); setDuration(status.durationMillis?status.durationMillis/1000:1); } } catch(e) {} }, 1000); }
//     return () => clearInterval(interval);
//   }, [sound, isPlaying]);

//   const handleAutoNext = async (currentSound: Audio.Sound) => {
//     const list = playlistRef.current; const curr = currentTrackRef.current; const mode = playbackModeRef.current;
//     if (!curr||list.length===0) return;
//     if (mode==='loop_one') await currentSound.replayAsync();
//     else if (mode==='play_one') { setIsPlaying(false); setPosition(0); await currentSound.stopAsync(); await currentSound.setPositionAsync(0); }
//     else if (mode==='play_all') { const idx=list.findIndex(t=>t.id===curr.id); if(idx!==-1&&idx<list.length-1) playTrack(list[idx+1]); else { setIsPlaying(false); setPosition(0); await currentSound.stopAsync(); await currentSound.setPositionAsync(0); } }
//     else if (mode==='loop_all') { const idx=list.findIndex(t=>t.id===curr.id); playTrack(list[(idx+1)%list.length]); }
//   };

//   const saveUserData = async (data: UserData) => { await AsyncStorage.setItem('userData', JSON.stringify(data)); setUserData(data); };
//   const updateCustomPrograms = async (programs: CustomProgram[]) => { setCustomPrograms(programs); await AsyncStorage.setItem('customPrograms', JSON.stringify(programs)); };

//   const playTrack = async (track: MusicTrack) => {
//     if (musicLoading) return;
//     if (currentTrack?.id===track.id&&sound) { const status = await sound.getStatusAsync(); if(status.isLoaded&&!status.isPlaying) { await sound.playAsync(); setIsPlaying(true); return; } }
//     try {
//       setMusicLoading(true);
//       if (sound) { await sound.unloadAsync(); setSound(null); }
//       const source = track.isLocal ? track.path : { uri: track.path };
//       const shouldLoop = playbackModeRef.current==='loop_one';
//       const { sound: newSound } = await Audio.Sound.createAsync(source, { shouldPlay: true, isLooping: shouldLoop });
//       newSound.setOnPlaybackStatusUpdate((status) => { if(status.isLoaded&&status.didJustFinish&&!status.isLooping) handleAutoNext(newSound); });
//       if (isMuted) await newSound.setIsMutedAsync(true);
//       setSound(newSound); setCurrentTrack(track); setIsPlaying(true); setMusicLoading(false);
//     } catch (error) { console.log('Play Error',error); setMusicLoading(false); showAlert('Error','Could not play audio track.'); }
//   };

//   const togglePlayPause = async () => { if(!sound) { if(playlist.length>0) playTrack(playlist[0]); return; } if(musicLoading) return; if(isPlaying) { await sound.pauseAsync(); setIsPlaying(false); } else { await sound.playAsync(); setIsPlaying(true); } };
//   const seekTrack = async (value: number) => { if(sound&&!musicLoading) { await sound.setPositionAsync(value*1000); setPosition(value); } };
//   const skipToNext = () => { if(!currentTrack||playlist.length===0) return; const idx=playlist.findIndex(t=>t.id===currentTrack.id); playTrack(playlist[(idx+1)%playlist.length]); };
//   const skipToPrev = () => { if(!currentTrack||playlist.length===0) return; const idx=playlist.findIndex(t=>t.id===currentTrack.id); playTrack(playlist[idx===0?playlist.length-1:idx-1]); };
//   const deleteTrack = async (trackId: string) => { if(trackId==='default_ost') return; if(currentTrack?.id===trackId) { if(sound) await sound.unloadAsync(); setSound(null); setCurrentTrack(null); setIsPlaying(false); } const newList=playlist.filter(t=>t.id!==trackId); setPlaylist(newList); AsyncStorage.setItem('musicPlaylist',JSON.stringify(newList)); };
//   const addMusicFile = async () => { try { const result = await DocumentPicker.getDocumentAsync({type:'audio/*'}); if(!result.canceled&&result.assets&&result.assets.length>0) { const file=result.assets[0]; const newTrack: MusicTrack={id:Date.now().toString(),title:file.name,path:file.uri,isLocal:false,isFavorite:false}; const newList=[...playlist,newTrack]; setPlaylist(newList); AsyncStorage.setItem('musicPlaylist',JSON.stringify(newList)); } } catch(e) { showAlert('Error','Failed to pick audio file'); } };

//   const MiniPlayer = () => {
//     if (!currentTrack) return null;
//     return (
//       <TouchableOpacity activeOpacity={0.9} onPress={() => navigateTo('music')} style={styles.miniPlayerContainer}>
//         <View style={styles.miniProgressContainer}><View style={[styles.miniProgressFill,{width:`${(position/(duration||1))*100}%`}]} /></View>
//         <View style={styles.miniPlayerContent}>
//           <View style={styles.miniInfo}>
//             {currentTrack.artwork?(<Image source={{uri:currentTrack.artwork}} style={styles.miniArt}/>):(<Ionicons name="musical-note" size={20} color={COLORS.blue} style={{marginRight:10}}/>)}
//             <View><Text style={styles.miniTitle} numberOfLines={1}>{currentTrack.title}</Text><Text style={styles.miniTime}>{formatTime(position)} / {formatTime(duration)}</Text></View>
//           </View>
//           <View style={styles.miniControls}>
//             <TouchableOpacity onPress={(e)=>{e.stopPropagation();skipToPrev();}} style={styles.miniCtrlBtn}><Ionicons name="play-skip-back" size={20} color={COLORS.text}/></TouchableOpacity>
//             <TouchableOpacity onPress={(e)=>{e.stopPropagation();togglePlayPause();}} style={styles.miniCtrlBtn}><Ionicons name={isPlaying?"pause":"play"} size={26} color={COLORS.white}/></TouchableOpacity>
//             <TouchableOpacity onPress={(e)=>{e.stopPropagation();skipToNext();}} style={styles.miniCtrlBtn}><Ionicons name="play-skip-forward" size={20} color={COLORS.text}/></TouchableOpacity>
//           </View>
//         </View>
//       </TouchableOpacity>
//     );
//   };

//   const renderScreen = () => {
//     if (!userData&&screen!=='loading'&&screen!=='setup') return <LoadingScreen />;
//     switch (screen) {
//       case 'loading': return <LoadingScreen />;
//       case 'setup': return <SetupScreen onComplete={(data) => { setUserData(data); setScreenState('assessment'); }} />;
//       case 'assessment': return <AssessmentScreen userData={userData!} onComplete={(stats, calculatedLevel) => { const finalData={...userData!,level:calculatedLevel,assessmentStats:stats,createdAt:new Date().toISOString(),lastDailyQuestCompleted:getISODate(new Date())}; saveUserData(finalData); navigateTo('dashboard'); }} />;
//       case 'dashboard': return <DashboardScreen userData={userData!} onNavigate={navigateTo} onStartQuest={() => navigateTo('quest')} />;
//       case 'quest': return <QuestScreen userData={userData!} customPrograms={customPrograms} onBack={() => navigateTo('dashboard')} onStartTraining={(quest) => { setCurrentQuest(quest); setIsTraining(true); navigateTo('training'); }} />;
//       case 'training': return <TrainingScreen userData={userData!} quest={currentQuest!} showAlert={showAlert} onComplete={(results, duration) => { updateProgress(results, duration); navigateTo('dashboard'); }} onBack={() => { showAlert("Abort Mission?","Stop training?",[{text:"Cancel",style:"cancel"},{text:"Quit",style:"destructive",onPress:()=>navigateTo('dashboard')}]); }} />;
//       case 'stats': return <StatsScreen userData={userData!} onBack={() => navigateTo('dashboard')} />;
//       case 'music': return <MusicScreen playlist={playlist} currentTrack={currentTrack} isPlaying={isPlaying} isLoading={musicLoading} position={position} duration={duration} playbackMode={playbackMode} onPlay={playTrack} onPause={togglePlayPause} onSeek={seekTrack} onNext={skipToNext} onPrev={skipToPrev} onDelete={deleteTrack} onAdd={addMusicFile} onToggleMode={async () => { const modes: PlaybackMode[]=['loop_all','play_all','loop_one','play_one']; const nextMode=modes[(modes.indexOf(playbackMode)+1)%modes.length]; setPlaybackMode(nextMode); if(sound) await sound.setIsLoopingAsync(nextMode==='loop_one'); }} onBack={() => navigateTo('dashboard')} />;
//       case 'programs': return <CustomProgramsScreen userData={userData!} customPrograms={customPrograms} setCustomPrograms={updateCustomPrograms} onBack={() => navigateTo('dashboard')} onStartProgram={(quest) => { setCurrentQuest(quest); setIsTraining(true); navigateTo('training'); }} showAlert={showAlert} />;
//       case 'settings': return <SettingsScreen userData={userData!} onSave={(data) => { saveUserData(data); navigateTo('dashboard'); }} onBack={() => navigateTo('dashboard')} />;
//       case 'timers': return <TimersScreen onBack={() => navigateTo('dashboard')} />;
//       default: return <LoadingScreen />;
//     }
//   };

//   const updateProgress = async (results: TrainingResult, duration: number) => {
//     try {
//       let xpGained = currentQuest?.isDaily ? currentQuest.rewards.xp : 100;
//       if (currentQuest?.isDaily) { userData!.lastDailyQuestCompleted = getISODate(new Date()); }
//       const history = await AsyncStorage.getItem('trainingHistory'); const parsed: TrainingHistory[] = history ? JSON.parse(history) : [];
//       parsed.push({ date: new Date().toISOString(), quest: currentQuest!, results, xpGained, durationSeconds: duration });
//       await AsyncStorage.setItem('trainingHistory', JSON.stringify(parsed));
//       const xpNeeded = userData!.level*XP_PER_LEVEL_BASE; let newTotalXP = userData!.xp+xpGained; let newLevel = userData!.level; let leveledUp = false;
//       while (newTotalXP>=xpNeeded) { newTotalXP -= xpNeeded; newLevel++; leveledUp = true; }
//       const newUserData: UserData = { ...userData!, xp: newTotalXP, level: newLevel, totalWorkouts: (userData!.totalWorkouts||0)+1 };
//       if (leveledUp) showAlert('LEVEL UP!',`You have reached Level ${newLevel}!`); else showAlert('QUEST COMPLETED',`You gained ${xpGained} Experience Points.`);
//       saveUserData(newUserData);
//     } catch (error) { console.error('Error updating progress:',error); }
//   };

//   return (
//     <SafeAreaProvider>
//       <SafeAreaView style={styles.container} edges={['top','bottom']}>
//         <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} translucent={false} />
//         <View style={{ flex: 1 }}>{renderScreen()}</View>
//         {currentTrack&&screen!=='music'&&<MiniPlayer />}
//         <CustomAlert {...alertState} onClose={closeAlert} />
//       </SafeAreaView>
//     </SafeAreaProvider>
//   );
// }

// // --- Screens ---

// function LoadingScreen() {
//   const spinValue = useRef(new Animated.Value(0)).current;
//   useEffect(() => { Animated.loop(Animated.timing(spinValue,{toValue:1,duration:2000,useNativeDriver:true})).start(); }, []);
//   const spin = spinValue.interpolate({inputRange:[0,1],outputRange:['0deg','360deg']});
//   return (<View style={styles.centerContainer}><Animated.View style={{transform:[{rotate:spin}],marginBottom:20}}><Ionicons name="reload-circle-outline" size={60} color={COLORS.blue}/></Animated.View><Text style={styles.loadingTitle}>SOLO LEVELING</Text><Text style={styles.loadingSubtitle}>INITIALIZING SYSTEM...</Text></View>);
// }

// function SetupScreen({ onComplete }: { onComplete: (data: UserData) => void }) {
//   const [formData, setFormData] = useState<any>({ name:'', level:1, sex:'male', weight:'', height:'', goal:'muscle' });
//   const [image, setImage] = useState<string | null>(null);
//   const pickImage = async () => { let result = await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Images,allowsEditing:true,aspect:[1,1],quality:0.5}); if(!result.canceled) setImage(result.assets[0].uri); };
//   const handleNext = () => { if(!formData.name) return; onComplete({...formData,weight:parseFloat(formData.weight)||70,height:parseFloat(formData.height)||170,xp:0,totalWorkouts:0,createdAt:new Date().toISOString(),cameraEnabled:false,profileImage:image||undefined}); };
//   const GoalButton = ({ type, icon, label }: { type: GoalType, icon: string, label: string }) => (<TouchableOpacity style={[styles.goalBtn,formData.goal===type&&styles.goalBtnActive]} onPress={() => setFormData({...formData,goal:type})}><MaterialCommunityIcons name={icon as any} size={24} color={formData.goal===type?COLORS.white:COLORS.blue}/><Text style={formData.goal===type?styles.goalTextActive:styles.goalText}>{label}</Text></TouchableOpacity>);
//   return (
//     <ScrollView style={styles.screenContainer} contentContainerStyle={{padding:20}} showsVerticalScrollIndicator={false}>
//       <Text style={styles.headerTitle}>PLAYER REGISTRATION</Text>
//       <TouchableOpacity onPress={pickImage} style={styles.avatarPicker}>{image?(<Image source={{uri:image}} style={styles.avatarImage}/>):(<View style={styles.avatarPlaceholder}><Ionicons name="camera" size={40} color={COLORS.textDark}/><Text style={styles.avatarText}>ADD PHOTO</Text></View>)}</TouchableOpacity>
//       <View style={styles.formGroup}><Text style={styles.label}>HUNTER NAME</Text><TextInput style={styles.input} placeholder="Enter Name" placeholderTextColor={COLORS.textDark} onChangeText={t=>setFormData({...formData,name:t})}/></View>
//       <View style={styles.formGroup}><Text style={styles.label}>GOAL / CLASS</Text><GoalButton type="muscle" icon="arm-flex" label="Muscle & Strength"/><GoalButton type="weight_loss" icon="run-fast" label="Weight Loss"/><GoalButton type="speed_strength" icon="flash" label="Speed & Strength (Assassin)"/></View>
//       <View style={styles.formGroup}><Text style={styles.label}>GENDER</Text><View style={styles.genderContainer}><TouchableOpacity style={[styles.genderBtn,formData.sex==='male'&&styles.genderBtnActive]} onPress={() => setFormData({...formData,sex:'male'})}><Ionicons name="male" size={20} color={formData.sex==='male'?COLORS.white:COLORS.blue}/><Text style={formData.sex==='male'?styles.genderTextActive:styles.genderText}>MALE</Text></TouchableOpacity><TouchableOpacity style={[styles.genderBtn,formData.sex==='female'&&styles.genderBtnActive]} onPress={() => setFormData({...formData,sex:'female'})}><Ionicons name="female" size={20} color={formData.sex==='female'?COLORS.white:COLORS.blue}/><Text style={formData.sex==='female'?styles.genderTextActive:styles.genderText}>FEMALE</Text></TouchableOpacity></View></View>
//       <View style={styles.row}><View style={[styles.formGroup,{flex:1,marginRight:10}]}><Text style={styles.label}>WEIGHT (KG)</Text><TextInput style={styles.input} keyboardType="numeric" onChangeText={t=>setFormData({...formData,weight:t})}/></View><View style={[styles.formGroup,{flex:1}]}><Text style={styles.label}>HEIGHT (CM)</Text><TextInput style={styles.input} keyboardType="numeric" onChangeText={t=>setFormData({...formData,height:t})}/></View></View>
//       <TouchableOpacity style={styles.mainButton} onPress={handleNext}><Text style={styles.mainButtonText}>PROCEED TO EVALUATION</Text></TouchableOpacity>
//     </ScrollView>
//   );
// }

// function AssessmentScreen({ userData, onComplete }: { userData: UserData, onComplete: (stats: any, level: number) => void }) {
//   const [step, setStep] = useState<'intro'|'active'|'rest'|'input'>('intro');
//   const [currentExIndex, setCurrentExIndex] = useState(0);
//   const [timer, setTimer] = useState(0);
//   const [reps, setReps] = useState('');
//   const [results, setResults] = useState<{[key:string]:number}>({});
//   const appStateRef = useRef(AppState.currentState);
//   const bgStartTimeRef = useRef<number | null>(null);

//   useEffect(() => {
//     const sub = AppState.addEventListener('change', nextState => {
//       if (appStateRef.current.match(/active/)&&nextState==='background') { bgStartTimeRef.current = Date.now(); }
//       if (appStateRef.current==='background'&&nextState==='active') { if(bgStartTimeRef.current!==null) { const elapsed=Math.floor((Date.now()-bgStartTimeRef.current)/1000); bgStartTimeRef.current=null; setTimer(prev=>Math.max(0,prev-elapsed)); } }
//       appStateRef.current = nextState;
//     });
//     return () => sub.remove();
//   }, []);

//   const getExercises = () => { if(userData.goal==='speed_strength') return ['pushups','jumpSquats','lunges']; else if(userData.goal==='weight_loss') return ['squats','situps','lunges']; else return ['pushups','squats','situps']; };
//   const exercises = getExercises(); const currentEx = exercises[currentExIndex]; const EX_TIME = 60; const REST_TIME = 15;

//   useEffect(() => {
//     let interval: NodeJS.Timeout;
//     if ((step==='active'||step==='rest')&&timer>0) {
//       interval = setInterval(() => {
//         setTimer(prev => {
//           if (prev<=1) {
//             if (step==='active') { Vibration.vibrate(); setStep('input'); }
//             else if (step==='rest') { if(currentExIndex<exercises.length-1) { setCurrentExIndex(prevIdx=>prevIdx+1); startExercise(); } else { finishAssessment(); } }
//             return 0;
//           }
//           return prev-1;
//         });
//       }, 1000);
//     }
//     return () => clearInterval(interval);
//   }, [step, timer]);

//   const startExercise = () => { setTimer(EX_TIME); setStep('active'); setReps(''); };
//   const handleInput = () => { const count=parseInt(reps)||0; setResults(prev=>({...prev,[currentEx]:count})); if(currentExIndex<exercises.length-1) { setTimer(REST_TIME); setStep('rest'); } else { finishAssessment(count); } };
//   const finishAssessment = (lastReps?: number) => { const finalResults=lastReps?{...results,[currentEx]:lastReps}:results; let totalReps=0; Object.values(finalResults).forEach(val=>totalReps+=val); const calculatedLevel=Math.max(1,Math.floor(totalReps/40)+1); onComplete(finalResults,calculatedLevel); };

//   return (
//     <View style={styles.centerContainer}>
//       <Text style={styles.headerTitle}>SYSTEM EVALUATION</Text>
//       {step==='intro'&&(<View style={{padding:20,alignItems:'center'}}><Text style={styles.questTitleDark}>RANKING TEST</Text><Text style={styles.alertMessage}>You will perform 3 exercises to determine your Hunter Rank. {"\n\n"}1 Minute MAX reps for each.{"\n"}15 Seconds rest between sets.</Text>{exercises.map(e=>(<View key={e} style={{flexDirection:'row',marginVertical:5}}><SoloIcon name={EXERCISES[e].iconName} lib={EXERCISES[e].iconLib} color={COLORS.blue}/><Text style={{color:COLORS.text,marginLeft:10}}>{EXERCISES[e].name}</Text></View>))}<TouchableOpacity style={styles.mainButton} onPress={startExercise}><Text style={styles.mainButtonText}>START TEST</Text></TouchableOpacity></View>)}
//       {step==='active'&&(
//         <View style={{alignItems:'center'}}>
//           <Text style={styles.loadingSubtitle}>CURRENT EXERCISE</Text><Text style={styles.loadingTitle}>{EXERCISES[currentEx].name}</Text>
//           <View style={styles.timerCircle}><Text style={styles.timerText}>{timer}</Text></View>
//           <Text style={styles.label}>DO AS MANY AS YOU CAN</Text>
//           <TouchableOpacity style={[styles.mainButton,{backgroundColor:COLORS.accent,marginTop:15,paddingHorizontal:30}]} onPress={() => { Vibration.vibrate(); setTimer(0); setStep('input'); }}>
//             <Text style={[styles.mainButtonText,{color:COLORS.gold}]}>SKIP (ENTER RESULT)</Text>
//           </TouchableOpacity>
//         </View>
//       )}
//       {step==='input'&&(<View style={{alignItems:'center',width:'80%'}}><Text style={styles.questTitleDark}>TIME'S UP</Text><Text style={styles.label}>ENTER REPS COMPLETED:</Text><TextInput style={[styles.input,{textAlign:'center',fontSize:24,width:100}]} keyboardType="numeric" value={reps} onChangeText={setReps} autoFocus/><TouchableOpacity style={styles.mainButton} onPress={handleInput}><Text style={styles.mainButtonText}>CONFIRM</Text></TouchableOpacity></View>)}
//       {step==='rest'&&(
//         <View style={{alignItems:'center'}}>
//           <Text style={styles.loadingTitle}>REST</Text><Text style={styles.timerText}>{timer}</Text><Text style={styles.loadingSubtitle}>NEXT: {EXERCISES[exercises[currentExIndex+1]]?.name}</Text>
//           <TouchableOpacity style={[styles.mainButton,{backgroundColor:COLORS.accent,marginTop:20,paddingHorizontal:30}]} onPress={() => { setTimer(0); if(currentExIndex<exercises.length-1) { setCurrentExIndex(prev=>prev+1); startExercise(); } else finishAssessment(); }}>
//             <Text style={[styles.mainButtonText,{color:COLORS.gold}]}>SKIP REST</Text>
//           </TouchableOpacity>
//         </View>
//       )}
//     </View>
//   );
// }

// function DashboardScreen({ userData, onNavigate, onStartQuest }: any) {
//   if (!userData) return null;
//   const xpPercent = (Math.max(0,userData.xp)/(userData.level*XP_PER_LEVEL_BASE))*100;
//   return (
//     <ScrollView style={styles.screenContainer} showsVerticalScrollIndicator={false}>
//       <View style={styles.dashboardHeader}>
//         <View style={styles.profileRow}>
//           <Image source={userData.profileImage?{uri:userData.profileImage}:{uri:'https://via.placeholder.com/150'}} style={styles.profileImageSmall}/>
//           <View><Text style={styles.playerName}>{userData.name}</Text><Text style={styles.playerRank}>LEVEL {userData.level}</Text><Text style={{color:COLORS.gold,fontSize:10,letterSpacing:1}}>CLASS: {userData.goal.replace('_',' ').toUpperCase()}</Text></View>
//         </View>
//       </View>
//       <View style={styles.systemWindow}>
//         <Text style={styles.systemHeader}>STATUS</Text>
//         <View style={styles.xpBarContainer}><View style={[styles.xpBarFill,{width:`${xpPercent}%`}]}/></View>
//         <Text style={styles.xpText}>{userData.xp} / {userData.level*XP_PER_LEVEL_BASE} XP</Text>
//         <View style={styles.statGrid}>
//           <View style={styles.statItem}><Ionicons name="barbell-outline" size={20} color={COLORS.blue}/><Text style={styles.statVal}>{userData.totalWorkouts}</Text><Text style={styles.statLbl}>Raids</Text></View>
//           <View style={styles.statItem}><MaterialCommunityIcons name="fire" size={20} color={COLORS.danger}/><Text style={styles.statVal}>{userData.level}</Text><Text style={styles.statLbl}>Rank</Text></View>
//         </View>
//       </View>
//       <View style={styles.menuGrid}>
//         <TouchableOpacity style={styles.menuCardLarge} onPress={onStartQuest}><MaterialCommunityIcons name="sword-cross" size={40} color={COLORS.gold}/><Text style={styles.menuTitle}>DAILY QUEST</Text><Text style={styles.menuSub}>{userData.lastDailyQuestCompleted===getISODate(new Date())?'Completed':'Available'}</Text></TouchableOpacity>
//         <View style={styles.menuRow}>
//           <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('programs')}><Ionicons name="list" size={24} color={COLORS.blue}/><Text style={styles.menuTitleSmall}>Programs</Text></TouchableOpacity>
//           <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('stats')}><Ionicons name="stats-chart" size={24} color={COLORS.success}/><Text style={styles.menuTitleSmall}>Stats</Text></TouchableOpacity>
//         </View>
//         <View style={styles.menuRow}>
//           <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('music')}><Ionicons name="musical-notes" size={24} color={COLORS.purple}/><Text style={styles.menuTitleSmall}>Music</Text></TouchableOpacity>
//           <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('timers')}><Ionicons name="timer-outline" size={24} color={COLORS.gold}/><Text style={styles.menuTitleSmall}>Timers</Text></TouchableOpacity>
//         </View>
//         <View style={styles.menuRow}>
//           <TouchableOpacity style={[styles.menuCardSmall,{width:'100%'}]} onPress={() => onNavigate('settings')}><Ionicons name="settings" size={24} color={COLORS.textDark}/><Text style={styles.menuTitleSmall}>Settings</Text></TouchableOpacity>
//         </View>
//       </View>
//     </ScrollView>
//   );
// }

// // --- Stopwatch Component ---
// function Stopwatch() {
//   const [elapsedMs, setElapsedMs] = useState(0);
//   const [running, setRunning] = useState(false);
//   const startTimeRef = useRef<number | null>(null);
//   const accumulatedRef = useRef(0);
//   const intervalRef = useRef<NodeJS.Timeout | null>(null);
//   const appStateRef = useRef(AppState.currentState);

//   const bgEnterTimeRef = useRef<number | null>(null);
//   useEffect(() => {
//     const sub = AppState.addEventListener('change', nextState => {
//       if (appStateRef.current.match(/active/) && nextState === 'background' && running) {
//         // Record when we went to background; add current interval to accumulated
//         bgEnterTimeRef.current = Date.now();
//         if (startTimeRef.current !== null) { accumulatedRef.current += Date.now() - startTimeRef.current; startTimeRef.current = null; }
//       }
//       if (appStateRef.current === 'background' && nextState === 'active' && running) {
//         // Add the time spent in background to accumulated, restart interval reference
//         if (bgEnterTimeRef.current !== null) { accumulatedRef.current += Date.now() - bgEnterTimeRef.current; bgEnterTimeRef.current = null; }
//         startTimeRef.current = Date.now();
//       }
//       appStateRef.current = nextState;
//     });
//     return () => sub.remove();
//   }, [running]);

//   const start = () => {
//     if (running) return;
//     startTimeRef.current = Date.now(); setRunning(true);
//     intervalRef.current = setInterval(() => { const base = startTimeRef.current ? Date.now()-startTimeRef.current : 0; setElapsedMs(accumulatedRef.current+base); }, 33);
//   };
//   const pause = () => {
//     if (!running) return;
//     if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
//     if (startTimeRef.current !== null) { accumulatedRef.current += Date.now()-startTimeRef.current; startTimeRef.current = null; }
//     setRunning(false);
//   };
//   const reset = () => {
//     if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
//     startTimeRef.current = null; accumulatedRef.current = 0; setElapsedMs(0); setRunning(false);
//   };
//   useEffect(() => { return () => { if(intervalRef.current) clearInterval(intervalRef.current); }; }, []);

//   const ms = elapsedMs%1000; const totalSec = Math.floor(elapsedMs/1000); const sec = totalSec%60;
//   const totalMin = Math.floor(totalSec/60); const min = totalMin%60;
//   const totalHr = Math.floor(totalMin/60); const hr = totalHr%24; const days = Math.floor(totalHr/24);
//   const showHours = totalHr > 0; const showDays = days > 0;

//   const ArcRing = ({ fill, color, label, value }: { fill: number; color: string; label: string; value: string }) => (
//     <View style={{alignItems:'center',marginHorizontal:5}}>
//       <View style={{width:50,height:50,borderRadius:25,justifyContent:'center',alignItems:'center'}}>
//         <View style={{position:'absolute',width:50,height:50,borderRadius:25,borderWidth:4,borderColor:COLORS.accent}}/>
//         <View style={{position:'absolute',width:50,height:50,borderRadius:25,borderWidth:4,borderColor:color,opacity:Math.max(0.15,fill),transform:[{rotate:`${-90+fill*360}deg`}]}}/>
//         <View style={{position:'absolute',width:34,height:34,borderRadius:17,backgroundColor:COLORS.secondary}}/>
//         <Text style={{color:COLORS.white,fontSize:11,fontWeight:'800',zIndex:2}}>{value}</Text>
//       </View>
//       <Text style={{color,fontSize:8,fontWeight:'bold',marginTop:3,letterSpacing:1}}>{label}</Text>
//     </View>
//   );

//   return (
//     <View style={{backgroundColor:COLORS.secondary,borderRadius:14,padding:16,marginBottom:20,borderWidth:1,borderColor:COLORS.purple}}>
//       <Text style={[styles.label,{color:COLORS.purple,marginBottom:12,textAlign:'center',letterSpacing:2}]}>STOPWATCH</Text>
//       <Text style={{color:COLORS.white,fontSize:30,fontWeight:'900',textAlign:'center',letterSpacing:2,marginBottom:14}}>
//         {showDays?`${days}d `:''}{showHours?`${pad2(hr)}:`:''}
//         {pad2(min)}:{pad2(sec)}<Text style={{fontSize:18,color:COLORS.textDark}}>.{pad3(ms)}</Text>
//       </Text>
//       <View style={{flexDirection:'row',justifyContent:'center',marginBottom:14}}>
//         {showDays&&<ArcRing fill={Math.min(days/6,1)} color={COLORS.gold} label="DAYS" value={`${days}`}/>}
//         {showHours&&<ArcRing fill={hr/23} color={COLORS.danger} label="HRS" value={pad2(hr)}/>}
//         <ArcRing fill={min/59} color={COLORS.blue} label="MIN" value={pad2(min)}/>
//         <ArcRing fill={sec/59} color={COLORS.success} label="SEC" value={pad2(sec)}/>
//         <ArcRing fill={ms/999} color={COLORS.purple} label="MS" value={pad3(ms)}/>
//       </View>
//       <View style={{flexDirection:'row',justifyContent:'center'}}>
//         <TouchableOpacity style={[styles.timerCtrlBtn,{backgroundColor:running?COLORS.accent:COLORS.purple,marginRight:10}]} onPress={running?pause:start}>
//           <Ionicons name={running?"pause":"play"} size={22} color={COLORS.white}/><Text style={styles.timerCtrlText}>{running?'PAUSE':'START'}</Text>
//         </TouchableOpacity>
//         <TouchableOpacity style={[styles.timerCtrlBtn,{backgroundColor:COLORS.accent}]} onPress={reset}>
//           <Ionicons name="refresh" size={22} color={COLORS.text}/><Text style={styles.timerCtrlText}>RESET</Text>
//         </TouchableOpacity>
//       </View>
//     </View>
//   );
// }

// // --- Timers Screen ---
// function TimersScreen({ onBack }: { onBack: () => void }) {
//   const [customTimers, setCustomTimers] = useState<CustomTimer[]>([]);
//   const [activeTimers, setActiveTimers] = useState<{[id:string]: number}>({});
//   const [runningTimers, setRunningTimers] = useState<{[id:string]: boolean}>({});
//   // Linked numpad input: 6 digit slots [H,H,M,M,S,S], right-to-left (calculator style)
//   const [digits, setDigits] = useState<string[]>(['0','0','0','0','0','0']);
//   const [newLabel, setNewLabel] = useState('');
//   const intervalsRef = useRef<{[id:string]: NodeJS.Timeout}>({});
//   const bgStartRef = useRef<{[id:string]: number}>({});
//   const appStateRef = useRef(AppState.currentState);

//   useEffect(() => {
//     AsyncStorage.getItem('customTimers').then(data => { if(data) { const timers: CustomTimer[] = JSON.parse(data); setCustomTimers(timers); const init: {[id:string]:number}={}; timers.forEach(t=>init[t.id]=t.seconds); setActiveTimers(init); } });
//   }, []);

//   useEffect(() => {
//     const sub = AppState.addEventListener('change', nextState => {
//       if (appStateRef.current.match(/active/)&&nextState==='background') { Object.keys(runningTimers).forEach(id => { if(runningTimers[id]) bgStartRef.current[id]=Date.now(); }); }
//       if (appStateRef.current==='background'&&nextState==='active') {
//         const elapsed: {[id:string]:number}={};
//         Object.keys(bgStartRef.current).forEach(id => { elapsed[id]=Math.floor((Date.now()-bgStartRef.current[id])/1000); delete bgStartRef.current[id]; });
//         if (Object.keys(elapsed).length>0) setActiveTimers(prev => { const next={...prev}; Object.keys(elapsed).forEach(id => { next[id]=Math.max(0,(next[id]||0)-elapsed[id]); }); return next; });
//       }
//       appStateRef.current = nextState;
//     });
//     return () => sub.remove();
//   }, [runningTimers]);

//   const saveTimers = async (timers: CustomTimer[]) => { setCustomTimers(timers); await AsyncStorage.setItem('customTimers', JSON.stringify(timers)); };

//   // Push digit right, shift left (calculator numpad style)
//   const pushDigit = (d: string) => setDigits(prev => [...prev.slice(1), d]);
//   const clearDigits = () => setDigits(['0','0','0','0','0','0']);
//   const backspaceDigit = () => setDigits(prev => ['0', ...prev.slice(0,5)]);

//   const { hours, minutes, seconds } = parseLinkedDigits(digits);
//   const totalSeconds = hours*3600 + minutes*60 + seconds;

//   const addTimer = () => {
//     if (totalSeconds<=0) return;
//     const id = Date.now().toString();
//     const label = newLabel || `${hours>0?hours+'h ':''} ${minutes>0?minutes+'m ':''} ${seconds>0?seconds+'s':''}`.trim().replace(/\s+/g,' ');
//     const timer: CustomTimer = { id, label, seconds: totalSeconds };
//     const updated = [...customTimers, timer];
//     saveTimers(updated); setActiveTimers(prev => ({...prev,[id]:totalSeconds})); setNewLabel(''); clearDigits();
//   };

//   const deleteTimer = (id: string) => {
//     if (intervalsRef.current[id]) { clearInterval(intervalsRef.current[id]); delete intervalsRef.current[id]; }
//     setRunningTimers(prev => { const n={...prev}; delete n[id]; return n; });
//     setActiveTimers(prev => { const n={...prev}; delete n[id]; return n; });
//     saveTimers(customTimers.filter(t=>t.id!==id));
//   };
//   const startTimer = (id: string) => {
//     if (intervalsRef.current[id]) return;
//     setRunningTimers(prev => ({...prev,[id]:true}));
//     intervalsRef.current[id] = setInterval(() => {
//       setActiveTimers(prev => {
//         const cur = (prev[id]||0); if(cur<=1) { clearInterval(intervalsRef.current[id]); delete intervalsRef.current[id]; setRunningTimers(p=>({...p,[id]:false})); Vibration.vibrate([0,500,200,500]); return {...prev,[id]:0}; }
//         return {...prev,[id]:cur-1};
//       });
//     }, 1000);
//   };
//   const pauseTimer = (id: string) => { if(intervalsRef.current[id]) { clearInterval(intervalsRef.current[id]); delete intervalsRef.current[id]; } setRunningTimers(prev=>({...prev,[id]:false})); };
//   const resetTimer = (id: string) => { pauseTimer(id); const original = customTimers.find(t=>t.id===id); if(original) setActiveTimers(prev=>({...prev,[id]:original.seconds})); };
//   useEffect(() => { return () => { Object.values(intervalsRef.current).forEach(clearInterval); }; }, []);

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>TIMERS</Text><View style={{width:24}}/></View>
//       <ScrollView style={{padding:20}} showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom:30}}>

//         <Stopwatch />

//         {/* Countdown timer creator with linked numpad */}
//         <View style={{backgroundColor:COLORS.secondary,borderRadius:14,padding:16,marginBottom:20,borderWidth:1,borderColor:COLORS.accent}}>
//           <Text style={[styles.label,{marginBottom:12,textAlign:'center',letterSpacing:2}]}>CREATE COUNTDOWN TIMER</Text>
//           {/* HH:MM:SS linked display */}
//           <View style={{flexDirection:'row',justifyContent:'center',alignItems:'center',marginBottom:14}}>
//             <View style={styles.linkedSegment}><Text style={styles.linkedLabel}>HH</Text><Text style={styles.linkedValue}>{pad2(hours)}</Text></View>
//             <Text style={styles.linkedSep}>:</Text>
//             <View style={styles.linkedSegment}><Text style={styles.linkedLabel}>MM</Text><Text style={styles.linkedValue}>{pad2(minutes)}</Text></View>
//             <Text style={styles.linkedSep}>:</Text>
//             <View style={styles.linkedSegment}><Text style={styles.linkedLabel}>SS</Text><Text style={styles.linkedValue}>{pad2(seconds)}</Text></View>
//           </View>
//           {/* Numpad */}
//           <View style={{marginBottom:10}}>
//             {[['1','2','3'],['4','5','6'],['7','8','9'],['C','0','⌫']].map((row, ri) => (
//               <View key={ri} style={{flexDirection:'row',justifyContent:'center',marginBottom:6}}>
//                 {row.map(key => (
//                   <TouchableOpacity key={key} style={styles.numpadBtn} onPress={() => {
//                     if (key==='C') clearDigits();
//                     else if (key==='⌫') backspaceDigit();
//                     else pushDigit(key);
//                   }}>
//                     <Text style={[styles.numpadText, key==='C'&&{color:COLORS.danger}, key==='⌫'&&{color:COLORS.gold}]}>{key}</Text>
//                   </TouchableOpacity>
//                 ))}
//               </View>
//             ))}
//           </View>
//           <TextInput style={[styles.input,{marginBottom:8}]} placeholder="Label (optional)" placeholderTextColor={COLORS.textDark} value={newLabel} onChangeText={setNewLabel}/>
//           <TouchableOpacity style={[styles.mainButton,{marginTop:0,opacity:totalSeconds>0?1:0.4}]} onPress={addTimer} disabled={totalSeconds<=0}>
//             <Text style={styles.mainButtonText}>ADD TIMER</Text>
//           </TouchableOpacity>
//         </View>

//         {customTimers.length===0&&<Text style={{color:COLORS.textDark,textAlign:'center',marginTop:10,marginBottom:20}}>No countdown timers yet.</Text>}
//         {customTimers.map(timer => {
//           const remaining = activeTimers[timer.id]??timer.seconds;
//           const isRunning = runningTimers[timer.id]||false;
//           const progress = timer.seconds > 0 ? remaining/timer.seconds : 0;
//           const finished = remaining===0;
//           return (
//             <View key={timer.id} style={{backgroundColor:COLORS.secondary,borderRadius:12,padding:20,marginBottom:15,borderWidth:1,borderColor:finished?COLORS.gold:isRunning?COLORS.blue:COLORS.accent}}>
//               <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
//                 <Text style={{color:COLORS.text,fontWeight:'bold',fontSize:16}}>{timer.label}</Text>
//                 <TouchableOpacity onPress={() => deleteTimer(timer.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger}/></TouchableOpacity>
//               </View>
//               <View style={{height:4,backgroundColor:COLORS.accent,borderRadius:2,marginBottom:12}}><View style={{height:'100%',width:`${Math.max(0,progress*100)}%`,backgroundColor:finished?COLORS.gold:COLORS.blue,borderRadius:2}}/></View>
//               <Text style={{color:finished?COLORS.gold:COLORS.white,fontSize:44,fontWeight:'900',textAlign:'center',letterSpacing:2,marginBottom:8}}>{formatCountdown(remaining)}</Text>
//               {finished&&<Text style={{color:COLORS.gold,textAlign:'center',fontWeight:'bold',letterSpacing:2,marginBottom:8}}>⚡ TIME'S UP!</Text>}
//               <View style={{flexDirection:'row',justifyContent:'center'}}>
//                 <TouchableOpacity style={[styles.timerCtrlBtn,{backgroundColor:isRunning?COLORS.accent:COLORS.blue,marginRight:10}]} onPress={() => isRunning?pauseTimer(timer.id):startTimer(timer.id)}>
//                   <Ionicons name={isRunning?"pause":"play"} size={22} color={COLORS.white}/><Text style={styles.timerCtrlText}>{isRunning?'PAUSE':'START'}</Text>
//                 </TouchableOpacity>
//                 <TouchableOpacity style={[styles.timerCtrlBtn,{backgroundColor:COLORS.accent}]} onPress={() => resetTimer(timer.id)}>
//                   <Ionicons name="refresh" size={22} color={COLORS.text}/><Text style={styles.timerCtrlText}>RESET</Text>
//                 </TouchableOpacity>
//               </View>
//             </View>
//           );
//         })}
//       </ScrollView>
//     </View>
//   );
// }

// function MusicScreen({ playlist, currentTrack, isPlaying, isLoading, position, duration, playbackMode, onPlay, onPause, onSeek, onNext, onPrev, onDelete, onAdd, onToggleMode, onBack }: any) {
//   const [searchQuery, setSearchQuery] = useState('');
//   const getModeIcon = () => { switch(playbackMode) { case 'loop_one': return 'repeat-once'; case 'loop_all': return 'repeat'; case 'play_one': return 'numeric-1-box-outline'; case 'play_all': return 'playlist-play'; default: return 'repeat'; } };
//   const filteredPlaylist = playlist.filter((track: MusicTrack) => track.title.toLowerCase().includes(searchQuery.toLowerCase()));
//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>MUSIC PLAYER</Text><TouchableOpacity onPress={onToggleMode} style={styles.modeBtnHeader}><MaterialCommunityIcons name={getModeIcon()} size={20} color={COLORS.blue}/></TouchableOpacity></View>
//       <View style={styles.playerMain}>
//         {currentTrack&&currentTrack.artwork?(<Image source={{uri:currentTrack.artwork}} style={styles.albumArt}/>):(<View style={styles.albumArtPlaceholder}><Ionicons name="musical-note" size={80} color={COLORS.highlight}/></View>)}
//         <Text style={styles.nowPlayingTitle} numberOfLines={1}>{currentTrack?currentTrack.title:'Select a Track'}</Text>
//         <View style={styles.seekContainer}><Text style={styles.timeText}>{formatTime(position)}</Text><Slider style={{flex:1,marginHorizontal:10}} minimumValue={0} maximumValue={duration>0?duration:1} value={position} minimumTrackTintColor={COLORS.highlight} maximumTrackTintColor={COLORS.accent} thumbTintColor={COLORS.blue} onSlidingComplete={onSeek}/><Text style={styles.timeText}>{formatTime(duration)}</Text></View>
//         <View style={styles.playerControlsMain}>
//           <TouchableOpacity onPress={onPrev} style={styles.ctrlBtn}><Ionicons name="play-skip-back" size={30} color={COLORS.text}/></TouchableOpacity>
//           <TouchableOpacity onPress={onPause} style={styles.playButtonLarge}>{isLoading?(<View style={{width:30,height:30,borderWidth:3,borderRadius:15,borderColor:COLORS.primary,borderTopColor:COLORS.blue}}/>):(<Ionicons name={isPlaying?"pause":"play"} size={40} color={COLORS.primary}/>)}</TouchableOpacity>
//           <TouchableOpacity onPress={onNext} style={styles.ctrlBtn}><Ionicons name="play-skip-forward" size={30} color={COLORS.text}/></TouchableOpacity>
//         </View>
//       </View>
//       <View style={styles.playlistHeader}><Text style={styles.sectionTitle}>PLAYLIST</Text><TouchableOpacity onPress={onAdd} style={styles.addBtn}><Ionicons name="add" size={20} color={COLORS.primary}/></TouchableOpacity></View>
//       <View style={{paddingHorizontal:20,marginBottom:5}}><View style={styles.searchContainer}><Ionicons name="search" size={20} color={COLORS.textDark}/><TextInput style={styles.searchInput} placeholder="Search tracks..." placeholderTextColor={COLORS.textDark} value={searchQuery} onChangeText={setSearchQuery}/></View></View>
//       <ScrollView style={styles.playlistContainer} contentContainerStyle={{paddingBottom:20}} showsVerticalScrollIndicator={false}>
//         {filteredPlaylist.map((track: MusicTrack) => (
//           <View key={track.id} style={[styles.trackRow,currentTrack?.id===track.id&&styles.trackActive]}>
//             <TouchableOpacity style={styles.trackInfoArea} onPress={() => onPlay(track)}><View style={styles.trackIcon}><Ionicons name="musical-notes-outline" size={20} color={currentTrack?.id===track.id?COLORS.white:COLORS.textDark}/></View><Text style={[styles.trackName,currentTrack?.id===track.id&&styles.trackNameActive]} numberOfLines={1}>{track.title}</Text></TouchableOpacity>
//             <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(track.id)}><Ionicons name="trash-outline" size={18} color={COLORS.danger}/></TouchableOpacity>
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
//   // Stopwatch in ms for smooth display
//   const [workoutMs, setWorkoutMs] = useState(0);
//   const [activeExercise, setActiveExercise] = useState<string | null>(null);
//   const [manualInputs, setManualInputs] = useState<{[key:string]:string}>({});
//   const cameraRef = useRef<any>(null);
//   const appStateRef = useRef(AppState.currentState);
//   const startTimeRef = useRef<number>(Date.now());
//   const accumulatedMsRef = useRef(0);
//   const intervalRef = useRef<NodeJS.Timeout | null>(null);

//   useEffect(() => {
//     if (!permission) requestPermission();
//     const initCounts: any = {}; Object.keys(quest.exercises).forEach(k => initCounts[k]=0); setCounts(initCounts);
//   }, [permission]);

//   const bgEnterTimeTRef = useRef<number | null>(null);
//   useEffect(() => {
//     const sub = AppState.addEventListener('change', nextState => {
//       if (appStateRef.current.match(/active/) && nextState === 'background') {
//         bgEnterTimeTRef.current = Date.now();
//         accumulatedMsRef.current += Date.now() - startTimeRef.current;
//         startTimeRef.current = Date.now(); // keep valid so interval doesn't break
//       }
//       if (appStateRef.current === 'background' && nextState === 'active') {
//         if (bgEnterTimeTRef.current !== null) { accumulatedMsRef.current += Date.now() - bgEnterTimeTRef.current; bgEnterTimeTRef.current = null; }
//         startTimeRef.current = Date.now();
//       }
//       appStateRef.current = nextState;
//     });
//     return () => sub.remove();
//   }, []);

//   useEffect(() => {
//     startTimeRef.current = Date.now();
//     intervalRef.current = setInterval(() => { setWorkoutMs(accumulatedMsRef.current+(Date.now()-startTimeRef.current)); }, 33);
//     return () => { if(intervalRef.current) clearInterval(intervalRef.current); };
//   }, []);

//   const handleManualAdd = (ex: string, target: number) => { const amount=parseInt(manualInputs[ex]||'0'); if(amount>0) { const current=counts[ex]||0; const newVal=Math.min(current+amount,target); setCounts({...counts,[ex]:newVal}); setManualInputs({...manualInputs,[ex]:''}); } };
//   const handleDecrease = (ex: string) => { const current=counts[ex]||0; if(current>0) setCounts({...counts,[ex]:current-1}); };
//   const handleCheckAll = () => { showAlert("Complete All?","Mark all exercises as finished?",[{text:"Cancel",style:"cancel"},{text:"Yes",onPress:()=>setCounts(quest.exercises)}]); };
//   const isCompleted = (ex: string) => (counts[ex]||0)>=quest.exercises[ex];
//   const allCompleted = Object.keys(quest.exercises).every(isCompleted);
//   const isPoseSupported = (exKey: string) => PoseCalculator.isSupported(exKey);
//   const workoutSec = Math.floor(workoutMs/1000);

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}>
//         <TouchableOpacity onPress={onBack}><Ionicons name="close" size={24} color={COLORS.danger}/></TouchableOpacity>
//         <Text style={styles.headerTitle}>DUNGEON INSTANCE</Text>
//         <TouchableOpacity onPress={() => setCameraType(cameraType==='back'?'front':'back')}><Ionicons name="camera-reverse" size={24} color={COLORS.blue}/></TouchableOpacity>
//       </View>

//       {/* Stopwatch-style big training timer banner */}
//       <View style={styles.workoutTimerBanner}>
//         <Ionicons name="timer-outline" size={18} color={COLORS.gold}/>
//         <Text style={styles.workoutTimerText}>{formatStopwatch(workoutMs)}</Text>
//       </View>

//       {userData.cameraEnabled&&(
//         <View style={styles.cameraContainer}>
//           {permission?.granted?(
//             <CameraView style={styles.camera} facing={cameraType as any} ref={cameraRef}>
//               <View style={styles.cameraOverlay}>
//                 <Text style={styles.detectionText}>SYSTEM: POSE TRACKING ACTIVE</Text>
//                 {activeExercise&&!isPoseSupported(activeExercise)?(<View style={styles.camWarningBox}><Text style={styles.camWarningText}>CANNOT DETECT WITH CAM</Text></View>):(<View style={styles.poseBox}/>)}
//                 {activeExercise&&isPoseSupported(activeExercise)&&(<View style={styles.poseInfoBox}><Text style={styles.poseInfoText}>Detecting: {EXERCISES[activeExercise]?.name||activeExercise}</Text><Text style={styles.poseInfoSub}>Ensure full body visibility</Text></View>)}
//               </View>
//             </CameraView>
//           ):(
//             <View style={styles.cameraOff}><Ionicons name="videocam-off" size={40} color={COLORS.textDark}/><Text style={styles.cameraOffText}>CAMERA DISABLED</Text><Text style={styles.cameraOffSub}>Enable in Settings for Auto-Count</Text></View>
//           )}
//         </View>
//       )}

//       <ScrollView style={styles.exerciseList} contentContainerStyle={{paddingBottom:20}} showsVerticalScrollIndicator={false}>
//         {Object.entries(quest.exercises).map(([key, target]: [string, any]) => {
//           const def = quest.customExercises?.[key]||EXERCISES[key]||{name:key,iconName:'help',iconLib:'Ionicons'};
//           const count = counts[key]||0; const completed = isCompleted(key);
//           return (
//             <TouchableOpacity key={key} style={[styles.exerciseCard,completed&&styles.exerciseCardDone,activeExercise===key&&styles.exerciseCardActive]} onPress={() => setActiveExercise(key)}>
//               <View style={styles.exHeaderRow}>
//                 <View style={styles.exIcon}><SoloIcon name={def.iconName} lib={def.iconLib} size={28} color={COLORS.blue}/></View>
//                 <View style={{flex:1}}><Text style={styles.exName}>{def.name}</Text><View style={styles.progressBarBg}><View style={[styles.progressBarFill,{width:`${Math.min((count/target)*100,100)}%`}]}/></View></View>
//                 <Text style={styles.countTextLarge}>{count}/{target}</Text>
//               </View>
//               <View style={styles.seriesControls}>
//                 <TouchableOpacity style={styles.seriesBtnSmall} onPress={() => handleDecrease(key)} disabled={count===0}><Ionicons name="remove" size={16} color={COLORS.white}/></TouchableOpacity>
//                 <TextInput style={styles.seriesInput} placeholder="#" placeholderTextColor={COLORS.textDark} keyboardType="numeric" value={manualInputs[key]||''} onChangeText={(t) => setManualInputs({...manualInputs,[key]:t})}/>
//                 <TouchableOpacity style={styles.seriesBtn} onPress={() => handleManualAdd(key,target)} disabled={completed}><Text style={styles.seriesBtnText}>ADD SET</Text></TouchableOpacity>
//                 <TouchableOpacity style={[styles.checkBtn,completed?styles.checkBtnDone:{}]} onPress={() => setCounts({...counts,[key]:target})}><Ionicons name="checkmark" size={18} color={COLORS.white}/></TouchableOpacity>
//               </View>
//             </TouchableOpacity>
//           );
//         })}
//         <TouchableOpacity style={styles.checkAllBtn} onPress={handleCheckAll}><Text style={styles.checkAllText}>COMPLETE ALL EXERCISES</Text></TouchableOpacity>
//         {allCompleted&&(<TouchableOpacity style={styles.completeBtn} onPress={() => onComplete(counts,workoutSec)}><Text style={styles.completeBtnText}>COMPLETE DUNGEON</Text></TouchableOpacity>)}
//       </ScrollView>
//     </View>
//   );
// }

// function CustomProgramsScreen({ userData, customPrograms, setCustomPrograms, onBack, onStartProgram, showAlert }: any) {
//   const [modalVisible, setModalVisible] = useState(false);
//   const [newProgName, setNewProgName] = useState(''); const [editingId, setEditingId] = useState<string|null>(null);
//   const [selectedEx, setSelectedEx] = useState<{[key:string]:number}>({}); const [customList, setCustomList] = useState<Array<{id:string,name:string,reps:number}>>([]); const [customExName, setCustomExName] = useState(''); const [customExCount, setCustomExCount] = useState('10'); const [schedule, setSchedule] = useState<string[]>([]);
//   const toggleExercise = (key: string) => { const next={...selectedEx}; if(next[key]) delete next[key]; else next[key]=10; setSelectedEx(next); };
//   const updateReps = (key: string, val: string) => { setSelectedEx({...selectedEx,[key]:parseInt(val)||0}); };
//   const addCustomExercise = () => { if(!customExName) { showAlert("Error","Enter name"); return; } const newEx={id:`cust_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,name:customExName,reps:parseInt(customExCount)||10}; setCustomList([...customList,newEx]); setCustomExName(''); setCustomExCount('10'); };
//   const removeCustomExercise = (id: string) => { setCustomList(customList.filter(item=>item.id!==id)); };
//   const toggleDay = (day: string) => { if(schedule.includes(day)) setSchedule(schedule.filter(d=>d!==day)); else setSchedule([...schedule,day]); };
//   const openCreateModal = () => { setNewProgName(''); setEditingId(null); setSelectedEx({}); setCustomList([]); setSchedule([]); setModalVisible(true); };
//   const openEditModal = (prog: CustomProgram) => { setNewProgName(prog.name); setEditingId(prog.id); setSchedule(prog.schedule||[]); const stdEx: {[key:string]:number}={}; const cList: Array<{id:string,name:string,reps:number}>=[];  Object.entries(prog.exercises).forEach(([key,reps])=>{ if(EXERCISES[key]) stdEx[key]=reps; else if(prog.customExercises&&prog.customExercises[key]) cList.push({id:key,name:prog.customExercises[key].name,reps:reps}); }); setSelectedEx(stdEx); setCustomList(cList); setModalVisible(true); };
//   const saveProgram = () => { if(!newProgName) { showAlert("Error","Name required"); return; } let customDefs: ExerciseConfig={}; let finalExercises={...selectedEx}; customList.forEach(item=>{customDefs[item.id]={name:item.name,iconName:'star',iconLib:'Ionicons',custom:true,type:'reps'};finalExercises[item.id]=item.reps;}); const newProg: CustomProgram={id:editingId?editingId:Date.now().toString(),name:newProgName,exercises:finalExercises,customExercises:customDefs,schedule,createdAt:new Date().toISOString()}; let updated; if(editingId) updated=customPrograms.map((p:any)=>p.id===editingId?newProg:p); else updated=[...customPrograms,newProg]; setCustomPrograms(updated); setModalVisible(false); };
//   const deleteProgram = (id: string) => { setCustomPrograms(customPrograms.filter((p:any)=>p.id!==id)); };
//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>CUSTOM PROGRAMS</Text><TouchableOpacity onPress={openCreateModal}><Ionicons name="add-circle" size={30} color={COLORS.blue}/></TouchableOpacity></View>
//       <ScrollView style={{padding:20}} showsVerticalScrollIndicator={false}>
//         {customPrograms.map((p:any) => (
//           <View key={p.id} style={styles.programCard}>
//             <View style={{flex:1}}><Text style={styles.progTitle}>{p.name}</Text><Text style={styles.progSub}>{Object.keys(p.exercises).length} Exercises</Text>{p.schedule&&p.schedule.length>0&&<Text style={{color:COLORS.gold,fontSize:10}}>Scheduled: {p.schedule.join(', ')}</Text>}</View>
//             <TouchableOpacity style={styles.startBtnSmall} onPress={() => onStartProgram({title:p.name,difficulty:1,exercises:p.exercises,rewards:{xp:100,title:'Custom'},customExercises:p.customExercises,isDaily:false})}><Text style={styles.btnTextSmall}>START</Text></TouchableOpacity>
//             <TouchableOpacity style={styles.editProgBtn} onPress={() => openEditModal(p)}><Ionicons name="create-outline" size={20} color={COLORS.white}/></TouchableOpacity>
//             <TouchableOpacity style={styles.deleteProgBtn} onPress={() => deleteProgram(p.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger}/></TouchableOpacity>
//           </View>
//         ))}
//       </ScrollView>
//       <Modal visible={modalVisible} animationType="slide" transparent>
//         <View style={styles.modalOverlay}>
//           <View style={styles.createModal}>
//             <Text style={styles.modalTitle}>{editingId?'EDIT PROGRAM':'NEW PROGRAM'}</Text>
//             <TextInput style={styles.input} placeholder="Program Name" placeholderTextColor={COLORS.textDark} value={newProgName} onChangeText={setNewProgName}/>
//             <Text style={[styles.label,{marginTop:10}]}>Schedule as Daily Quest:</Text>
//             <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:10}}>{WEEK_DAYS.map(day=>(<TouchableOpacity key={day} onPress={()=>toggleDay(day)} style={[styles.dayBtn,schedule.includes(day)&&styles.dayBtnActive]}><Text style={[styles.dayBtnText,schedule.includes(day)&&{color:COLORS.white}]}>{day.charAt(0)}</Text></TouchableOpacity>))}</View>
//             <ScrollView style={{height:200,marginVertical:10}} showsVerticalScrollIndicator={false}>
//               {Object.entries(EXERCISES).map(([k,v])=>(<View key={k} style={styles.selectRowContainer}><Text style={styles.rowLabel}>{v.name}</Text><View style={{flexDirection:'row',alignItems:'center'}}>{selectedEx[k]?(<TextInput style={styles.repsInput} keyboardType="numeric" value={String(selectedEx[k])} onChangeText={(val)=>updateReps(k,val)}/>):null}<TouchableOpacity style={[styles.checkboxBtn,selectedEx[k]?styles.checkboxActive:{}]} onPress={()=>toggleExercise(k)}><Ionicons name={selectedEx[k]?"remove":"add"} size={20} color={selectedEx[k]?COLORS.white:COLORS.blue}/></TouchableOpacity></View></View>))}
//               {customList.length>0&&<Text style={[styles.label,{marginTop:15}]}>Added Custom:</Text>}
//               {customList.map(item=>(<View key={item.id} style={styles.selectRowContainer}><View style={{flex:1}}><Text style={styles.rowLabel}>{item.name} ({item.reps} reps)</Text></View><TouchableOpacity style={styles.deleteBtn} onPress={()=>removeCustomExercise(item.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger}/></TouchableOpacity></View>))}
//             </ScrollView>
//             <View style={{borderTopWidth:1,borderTopColor:COLORS.accent,paddingTop:10}}>
//               <Text style={styles.label}>Add Custom Exercise:</Text>
//               <View style={styles.row}>
//                 <TextInput style={[styles.input,{flex:2,marginRight:5}]} placeholder="Name" placeholderTextColor={COLORS.textDark} value={customExName} onChangeText={setCustomExName}/>
//                 <TextInput style={[styles.input,{flex:1,marginRight:5}]} keyboardType="numeric" placeholder="Reps" placeholderTextColor={COLORS.textDark} value={customExCount} onChangeText={setCustomExCount}/>
//                 <TouchableOpacity style={styles.addCustomBtn} onPress={addCustomExercise}><Ionicons name="add" size={24} color={COLORS.white}/></TouchableOpacity>
//               </View>
//             </View>
//             <View style={[styles.row,{marginTop:10}]}><TouchableOpacity style={styles.cancelBtn} onPress={()=>setModalVisible(false)}><Text style={styles.btnText}>CANCEL</Text></TouchableOpacity><TouchableOpacity style={styles.saveBtn} onPress={saveProgram}><Text style={styles.btnText}>SAVE</Text></TouchableOpacity></View>
//           </View>
//         </View>
//       </Modal>
//     </View>
//   );
// }

// function StatsScreen({ userData, onBack }: any) {
//   const [data, setData] = useState<number[]>([0]);
//   useEffect(() => { AsyncStorage.getItem('trainingHistory').then(h => { if(h) { const history=JSON.parse(h); const grouped: {[key:string]:number}={}; history.forEach((entry: TrainingHistory) => { const dateKey=entry.date.split('T')[0]; grouped[dateKey]=(grouped[dateKey]||0)+entry.xpGained; }); const sortedKeys=Object.keys(grouped).sort(); const xpData=sortedKeys.map(k=>grouped[k]); if(xpData.length>0) setData(xpData.slice(-6)); else setData([0]); } }); }, []);
//   return (
//     <ScrollView style={styles.screenContainer} showsVerticalScrollIndicator={false}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>STATISTICS</Text><View style={{width:24}}/></View>
//       <View style={{padding:20}}>
//         <Text style={styles.sectionTitle}>XP GAIN HISTORY</Text>
//         <LineChart data={{labels:["1","2","3","4","5","6"],datasets:[{data}]}} width={width-40} height={220} yAxisLabel="" yAxisSuffix=" XP" chartConfig={{backgroundColor:COLORS.secondary,backgroundGradientFrom:COLORS.secondary,backgroundGradientTo:COLORS.accent,decimalPlaces:0,color:(opacity=1)=>`rgba(59,130,246,${opacity})`,labelColor:(opacity=1)=>`rgba(255,255,255,${opacity})`,style:{borderRadius:16},propsForDots:{r:"6",strokeWidth:"2",stroke:COLORS.glow}}} style={{marginVertical:8,borderRadius:16}} bezier/>
//         <View style={styles.statBoxLarge}><Text style={styles.bigStat}>{userData.totalWorkouts}</Text><Text style={styles.bigStatLbl}>TOTAL DUNGEONS CLEARED</Text></View>
//       </View>
//     </ScrollView>
//   );
// }

// function QuestScreen({ userData, customPrograms, onBack, onStartTraining }: any) {
//   const getDailyQuest = (): Quest => {
//     const todayDay = getDayString(new Date()); const scheduledProg = customPrograms.find((p: CustomProgram) => p.schedule&&p.schedule.includes(todayDay));
//     if (scheduledProg) return { title:`DAILY: ${scheduledProg.name.toUpperCase()}`, difficulty:Math.floor(userData.level/5)+1, exercises:scheduledProg.exercises, customExercises:scheduledProg.customExercises, rewards:{xp:userData.level*100,title:'Hunter'}, isDaily:true };
//     const level=userData.level; let exercises: {[key:string]:number}={}; let title="DAILY QUEST"; let rewardXP=level*100;
//     if (userData.goal==='speed_strength') { title="ASSASSIN TRAINING"; exercises={clapPushups:Math.ceil(level*5),jumpSquats:Math.ceil(level*10),situps:Math.ceil(level*10),running:Math.min(1+(level*0.2),5)}; }
//     else if (userData.goal==='weight_loss') { title="ENDURANCE TRIAL"; exercises={squats:level*15,situps:level*15,burpees:level*5,running:Math.min(2+(level*0.5),10)}; }
//     else { title="STRENGTH TRAINING"; exercises={pushups:level*10,squats:level*10,situps:level*10,pullups:Math.ceil(level*2)}; }
//     return { title, difficulty:Math.floor(level/5)+1, exercises, rewards:{xp:rewardXP,title:'Hunter'}, isDaily:true };
//   };
//   const dailyQuest = getDailyQuest(); const [expanded, setExpanded] = useState(false);
//   const MAX_PREVIEW = 14; const exerciseEntries = Object.entries(dailyQuest.exercises); const hasMore = exerciseEntries.length>MAX_PREVIEW; const visibleExercises = expanded?exerciseEntries:exerciseEntries.slice(0,MAX_PREVIEW);
//   const isCompleted = userData.lastDailyQuestCompleted===getISODate(new Date());
//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>QUEST INFO</Text><View style={{width:24}}/></View>
//       <ScrollView style={{flex:1}} contentContainerStyle={{paddingBottom:10}} showsVerticalScrollIndicator={false}>
//         <View style={styles.questPaperDark}>
//           <Text style={styles.questTitleDark}>{dailyQuest.title}</Text>
//           <Text style={styles.difficulty}>Rank: {'★'.repeat(dailyQuest.difficulty)}</Text>
//           <View style={styles.divider}/>
//           <Text style={styles.objTitleDark}>OBJECTIVES:</Text>
//           {visibleExercises.map(([k,v]) => (<View key={k} style={[styles.objRow,{marginTop:5}]}><View style={{flexDirection:'row',alignItems:'center'}}><View style={{width:6,height:6,backgroundColor:COLORS.blue,marginRight:8}}/><Text style={styles.objTextDark}>{(dailyQuest.customExercises?.[k]?.name)||EXERCISES[k]?.name||k}</Text></View><Text style={styles.objValDark}>{String(v)}{EXERCISES[k]?.type==='distance'?' km':''}</Text></View>))}
//           {hasMore&&(<TouchableOpacity onPress={()=>setExpanded(!expanded)} style={styles.expandBtn}><Text style={styles.expandBtnText}>{expanded?'▲  SHOW LESS':`▼  +${exerciseEntries.length-MAX_PREVIEW} MORE OBJECTIVES`}</Text></TouchableOpacity>)}
//           <View style={styles.divider}/>
//           <Text style={styles.rewardTitleDark}>REWARDS:</Text>
//           <Text style={styles.rewardText}>+ {dailyQuest.rewards.xp} XP {isCompleted&&<Text style={{color:COLORS.gold}}>(REPEAT FOR BONUS XP)</Text>}</Text>
//         </View>
//       </ScrollView>
//       <View style={{paddingHorizontal:20,paddingTop:10,paddingBottom:10,borderTopWidth:1,borderTopColor:COLORS.accent,backgroundColor:COLORS.primary}}>
//         <TouchableOpacity style={[styles.acceptBtn,{marginBottom:0}]} onPress={() => onStartTraining(dailyQuest)}>
//           <Text style={styles.acceptBtnText}>{isCompleted?'REPEAT QUEST (+XP)':'ACCEPT QUEST'}</Text>
//         </TouchableOpacity>
//       </View>
//     </View>
//   );
// }

// function SettingsScreen({ userData, onSave, onBack }: any) {
//   const [camEnabled, setCamEnabled] = useState(userData.cameraEnabled); const [name, setName] = useState(userData.name); const [image, setImage] = useState(userData.profileImage);
//   const pickImage = async () => { let result = await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Images,allowsEditing:true,aspect:[1,1],quality:0.5}); if(!result.canceled) setImage(result.assets[0].uri); };
//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>SYSTEM SETTINGS</Text><View style={{width:24}}/></View>
//       <ScrollView style={{padding:20}} showsVerticalScrollIndicator={false}>
//         <View style={{alignItems:'center',marginBottom:20}}>
//           <TouchableOpacity onPress={pickImage}><Image source={image?{uri:image}:{uri:'https://via.placeholder.com/150'}} style={styles.settingsAvatar}/><View style={styles.editIconBadge}><Ionicons name="camera" size={14} color={COLORS.white}/></View></TouchableOpacity>
//           <Text style={[styles.label,{marginTop:10}]}>EDIT HUNTER NAME</Text><TextInput style={[styles.input,{textAlign:'center',width:'80%'}]} value={name} onChangeText={setName} placeholder="Hunter Name" placeholderTextColor={COLORS.textDark}/>
//         </View>
//         <View style={styles.divider}/>
//         <View style={styles.settingRow}><Text style={styles.settingText}>Enable Pose Detection (Camera)</Text><TouchableOpacity onPress={()=>setCamEnabled(!camEnabled)}><Ionicons name={camEnabled?"checkbox":"square-outline"} size={28} color={COLORS.blue}/></TouchableOpacity></View>
//         <TouchableOpacity style={styles.settingsSaveBtn} onPress={() => onSave({...userData,cameraEnabled:camEnabled,name,profileImage:image})}><Text style={styles.settingsSaveBtnText}>SAVE CHANGES</Text></TouchableOpacity>
//       </ScrollView>
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   expandBtn: { marginTop:10, alignItems:'center', paddingVertical:8, borderWidth:1, borderColor:COLORS.blue, borderRadius:6, borderStyle:'dashed' },
//   expandBtnText: { color:COLORS.blue, fontSize:11, fontWeight:'bold', letterSpacing:1.5 },
//   container: { flex:1, backgroundColor:COLORS.primary },
//   screenContainer: { flex:1, backgroundColor:COLORS.primary },
//   centerContainer: { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:COLORS.primary },
//   loadingTitle: { fontSize:32, fontWeight:'900', color:COLORS.blue, letterSpacing:4 },
//   loadingSubtitle: { color:COLORS.textDark, marginTop:10, letterSpacing:2 },
//   header: { flexDirection:'row', justifyContent:'space-between', padding:20, alignItems:'center', borderBottomWidth:1, borderBottomColor:COLORS.accent },
//   headerTitle: { color:COLORS.text, fontSize:18, fontWeight:'bold', letterSpacing:1.5 },
//   workoutTimerBanner: { flexDirection:'row', alignItems:'center', justifyContent:'center', paddingVertical:10, backgroundColor:COLORS.secondary, borderBottomWidth:1, borderBottomColor:COLORS.gold },
//   workoutTimerText: { color:COLORS.gold, fontSize:26, fontWeight:'900', letterSpacing:2, marginLeft:8 },
//   timerBadge: { flexDirection:'row', alignItems:'center', backgroundColor:COLORS.secondary, paddingVertical:4, paddingHorizontal:10, borderRadius:12, borderWidth:1, borderColor:COLORS.gold },
//   timerValue: { color:COLORS.gold, fontWeight:'bold', marginLeft:5, fontSize:12 },
//   avatarPicker: { alignSelf:'center', marginVertical:20 },
//   avatarPlaceholder: { width:100, height:100, borderRadius:50, backgroundColor:COLORS.accent, justifyContent:'center', alignItems:'center', borderStyle:'dashed', borderWidth:1, borderColor:COLORS.textDark },
//   avatarImage: { width:100, height:100, borderRadius:50 },
//   avatarText: { fontSize:10, color:COLORS.textDark, marginTop:5 },
//   formGroup: { marginBottom:15 },
//   row: { flexDirection:'row', justifyContent:'space-between' },
//   label: { color:COLORS.blue, fontSize:12, marginBottom:5, fontWeight:'bold' },
//   input: { backgroundColor:COLORS.secondary, color:COLORS.text, padding:15, borderRadius:8, borderWidth:1, borderColor:COLORS.accent },
//   genderContainer: { flexDirection:'row', justifyContent:'space-between' },
//   genderBtn: { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', padding:15, backgroundColor:COLORS.secondary, borderRadius:8, borderWidth:1, borderColor:COLORS.accent, marginHorizontal:5 },
//   genderBtnActive: { backgroundColor:COLORS.blue, borderColor:COLORS.glow },
//   genderText: { color:COLORS.blue, fontWeight:'bold', marginLeft:8 },
//   genderTextActive: { color:COLORS.white, fontWeight:'bold', marginLeft:8 },
//   goalBtn: { flexDirection:'row', alignItems:'center', padding:15, backgroundColor:COLORS.secondary, borderRadius:8, borderWidth:1, borderColor:COLORS.accent, marginBottom:8 },
//   goalBtnActive: { backgroundColor:COLORS.blue, borderColor:COLORS.glow },
//   goalText: { color:COLORS.blue, fontWeight:'bold', marginLeft:15 },
//   goalTextActive: { color:COLORS.white, fontWeight:'bold', marginLeft:15 },
//   mainButton: { backgroundColor:COLORS.blue, padding:18, borderRadius:8, alignItems:'center', marginTop:20 },
//   mainButtonText: { color:COLORS.primary, fontWeight:'bold', fontSize:16, letterSpacing:2 },
//   dashboardHeader: { padding:20, paddingTop:10 },
//   profileRow: { flexDirection:'row', alignItems:'center' },
//   profileImageSmall: { width:60, height:60, borderRadius:30, marginRight:15, borderWidth:2, borderColor:COLORS.blue },
//   playerName: { color:COLORS.text, fontSize:22, fontWeight:'bold' },
//   playerRank: { color:COLORS.glow, fontSize:12, letterSpacing:1 },
//   systemWindow: { margin:20, padding:20, backgroundColor:COLORS.secondary, borderRadius:12, borderWidth:1, borderColor:COLORS.blue },
//   systemHeader: { color:COLORS.text, textAlign:'center', fontWeight:'bold', marginBottom:15 },
//   xpBarContainer: { height:6, backgroundColor:COLORS.accent, borderRadius:3, marginBottom:5 },
//   xpBarFill: { height:'100%', backgroundColor:COLORS.blue, borderRadius:3 },
//   xpText: { color:COLORS.textDark, fontSize:10, textAlign:'right', marginBottom:15 },
//   statGrid: { flexDirection:'row', justifyContent:'space-around' },
//   statItem: { alignItems:'center' },
//   statVal: { color:COLORS.text, fontSize:18, fontWeight:'bold' },
//   statLbl: { color:COLORS.textDark, fontSize:10 },
//   menuGrid: { padding:20 },
//   menuCardLarge: { backgroundColor:COLORS.accent, padding:20, borderRadius:12, alignItems:'center', marginBottom:15, borderWidth:1, borderColor:COLORS.gold },
//   menuTitle: { color:COLORS.text, fontSize:18, fontWeight:'bold', marginTop:10 },
//   menuSub: { color:COLORS.danger, fontSize:12 },
//   menuRow: { flexDirection:'row', justifyContent:'space-between', marginBottom:15 },
//   menuCardSmall: { backgroundColor:COLORS.secondary, width:'48%', padding:15, borderRadius:12, alignItems:'center', borderWidth:1, borderColor:COLORS.accent },
//   menuTitleSmall: { color:COLORS.text, marginTop:5, fontSize:12 },
//   playerMain: { alignItems:'center', padding:20 },
//   albumArtPlaceholder: { width:140, height:140, backgroundColor:COLORS.secondary, borderRadius:12, justifyContent:'center', alignItems:'center', marginBottom:15, borderWidth:1, borderColor:COLORS.accent },
//   albumArt: { width:140, height:140, borderRadius:12, marginBottom:15, borderWidth:1, borderColor:COLORS.accent },
//   nowPlayingTitle: { color:COLORS.text, fontSize:18, fontWeight:'bold', marginBottom:10, textAlign:'center' },
//   seekContainer: { flexDirection:'row', alignItems:'center', width:'100%', marginBottom:15 },
//   timeText: { color:COLORS.textDark, fontSize:10, width:35, textAlign:'center' },
//   playerControlsMain: { flexDirection:'row', alignItems:'center', justifyContent:'space-around', width:'80%' },
//   playButtonLarge: { width:60, height:60, borderRadius:30, backgroundColor:COLORS.blue, justifyContent:'center', alignItems:'center' },
//   ctrlBtn: { padding:10 },
//   modeBtnHeader: { flexDirection:'row', alignItems:'center', backgroundColor:COLORS.secondary, padding:5, borderRadius:5, borderWidth:1, borderColor:COLORS.accent },
//   playlistHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:20, marginTop:10 },
//   sectionTitle: { color:COLORS.blue, fontWeight:'bold' },
//   addBtn: { backgroundColor:COLORS.highlight, padding:5, borderRadius:4 },
//   searchContainer: { flexDirection:'row', alignItems:'center', backgroundColor:COLORS.secondary, borderRadius:8, paddingHorizontal:10, paddingVertical:5, borderWidth:1, borderColor:COLORS.accent, marginTop:10 },
//   searchInput: { flex:1, color:COLORS.text, marginLeft:10, paddingVertical:5 },
//   playlistContainer: { padding:20 },
//   trackRow: { flexDirection:'row', alignItems:'center', paddingVertical:12, borderBottomWidth:1, borderBottomColor:COLORS.accent, justifyContent:'space-between' },
//   trackActive: { backgroundColor:COLORS.accent },
//   trackInfoArea: { flexDirection:'row', alignItems:'center', flex:1 },
//   trackIcon: { width:30 },
//   trackName: { color:COLORS.textDark, flex:1, fontSize:14, marginLeft:5 },
//   trackNameActive: { color:COLORS.white, fontWeight:'bold', textShadowColor:COLORS.glow, textShadowRadius:8 },
//   deleteBtn: { padding:5 },
//   miniPlayerContainer: { position:'relative', bottom:0, left:0, right:0, height:70, backgroundColor:COLORS.secondary, borderTopWidth:1, borderTopColor:COLORS.blue, zIndex:999 },
//   miniProgressContainer: { height:2, backgroundColor:COLORS.accent, width:'100%' },
//   miniProgressFill: { height:'100%', backgroundColor:COLORS.highlight },
//   miniPlayerContent: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:15, flex:1 },
//   miniInfo: { flexDirection:'row', alignItems:'center', flex:1, paddingRight:10 },
//   miniArt: { width:40, height:40, borderRadius:4, marginRight:10 },
//   miniTitle: { color:COLORS.white, fontWeight:'bold', fontSize:14 },
//   miniTime: { color:COLORS.textDark, fontSize:10 },
//   miniControls: { flexDirection:'row', alignItems:'center' },
//   miniCtrlBtn: { marginHorizontal:8 },
//   cameraContainer: { height:250, backgroundColor:'#000', overflow:'hidden' },
//   camera: { flex:1 },
//   cameraOverlay: { flex:1, justifyContent:'center', alignItems:'center' },
//   detectionText: { color:COLORS.success, fontSize:10, position:'absolute', top:10, right:10, backgroundColor:'rgba(0,0,0,0.5)', padding:4 },
//   poseBox: { width:200, height:300, borderWidth:2, borderColor:COLORS.glow, opacity:0.5 },
//   camWarningBox: { backgroundColor:'rgba(239,68,68,0.8)', padding:10, borderRadius:5 },
//   camWarningText: { color:COLORS.white, fontWeight:'bold' },
//   poseInfoBox: { position:'absolute', bottom:10, left:10, right:10, backgroundColor:'rgba(0,0,0,0.6)', padding:10, borderRadius:5 },
//   poseInfoText: { color:COLORS.success, fontWeight:'bold', fontSize:12 },
//   poseInfoSub: { color:COLORS.textDark, fontSize:10 },
//   cameraOff: { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:COLORS.secondary },
//   cameraOffText: { color:COLORS.text, fontWeight:'bold', marginTop:10 },
//   cameraOffSub: { color:COLORS.textDark, fontSize:10 },
//   exerciseList: { flex:1, padding:20 },
//   exerciseCard: { backgroundColor:COLORS.secondary, padding:15, marginBottom:10, borderRadius:8, borderWidth:1, borderColor:COLORS.accent },
//   exerciseCardActive: { borderColor:COLORS.blue, backgroundColor:'#1e293b' },
//   exerciseCardDone: { opacity:0.6, borderColor:COLORS.success },
//   exHeaderRow: { flexDirection:'row', alignItems:'center', marginBottom:10 },
//   exIcon: { width:40 },
//   exName: { color:COLORS.text, fontWeight:'bold', marginBottom:5 },
//   progressBarBg: { height:4, backgroundColor:COLORS.accent, borderRadius:2, width:'90%' },
//   progressBarFill: { height:'100%', backgroundColor:COLORS.blue, borderRadius:2 },
//   countTextLarge: { color:COLORS.white, fontSize:16, fontWeight:'bold' },
//   seriesControls: { flexDirection:'row', alignItems:'center', marginTop:5, justifyContent:'flex-end' },
//   seriesInput: { width:50, height:35, backgroundColor:COLORS.primary, color:COLORS.white, textAlign:'center', borderRadius:4, borderWidth:1, borderColor:COLORS.accent, marginHorizontal:5 },
//   seriesBtn: { backgroundColor:COLORS.blue, paddingHorizontal:10, paddingVertical:8, borderRadius:4, marginHorizontal:5 },
//   seriesBtnSmall: { backgroundColor:COLORS.accent, width:35, height:35, borderRadius:4, alignItems:'center', justifyContent:'center' },
//   seriesBtnText: { color:COLORS.white, fontSize:10, fontWeight:'bold' },
//   checkBtn: { width:35, height:35, borderRadius:17.5, borderWidth:1, borderColor:COLORS.textDark, alignItems:'center', justifyContent:'center', marginLeft:10 },
//   checkBtnDone: { backgroundColor:COLORS.success, borderColor:COLORS.success },
//   checkAllBtn: { marginVertical:10, padding:10, borderWidth:1, borderColor:COLORS.blue, borderRadius:8, alignItems:'center' },
//   checkAllText: { color:COLORS.blue, fontSize:12, fontWeight:'bold', letterSpacing:1 },
//   completeBtn: { backgroundColor:COLORS.blue, margin:20, padding:15, borderRadius:8, alignItems:'center' },
//   completeBtnText: { color:COLORS.primary, fontWeight:'bold', letterSpacing:2 },
//   programCard: { backgroundColor:COLORS.secondary, padding:15, borderRadius:8, marginBottom:15, flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
//   progTitle: { color:COLORS.text, fontSize:16, fontWeight:'bold' },
//   progSub: { color:COLORS.textDark, fontSize:12 },
//   startBtnSmall: { backgroundColor:COLORS.success, paddingHorizontal:12, paddingVertical:6, borderRadius:4, marginRight:10 },
//   editProgBtn: { backgroundColor:COLORS.accent, paddingHorizontal:8, paddingVertical:6, borderRadius:4, marginRight:10 },
//   deleteProgBtn: { padding:5 },
//   btnTextSmall: { color:COLORS.primary, fontWeight:'bold', fontSize:10 },
//   modalOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.8)', justifyContent:'center', padding:20 },
//   createModal: { backgroundColor:COLORS.secondary, padding:20, borderRadius:12, borderWidth:1, borderColor:COLORS.blue },
//   modalTitle: { color:COLORS.text, fontSize:18, fontWeight:'bold', textAlign:'center', marginBottom:15 },
//   selectRowContainer: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:10, borderBottomWidth:1, borderBottomColor:COLORS.accent },
//   rowLabel: { color:COLORS.textDark, fontSize:16 },
//   repsInput: { backgroundColor:COLORS.primary, color:COLORS.white, width:50, padding:5, borderRadius:4, textAlign:'center', borderWidth:1, borderColor:COLORS.blue, marginRight:10 },
//   checkboxBtn: { padding:5, borderRadius:4, borderWidth:1, borderColor:COLORS.blue },
//   checkboxActive: { backgroundColor:COLORS.danger, borderColor:COLORS.danger },
//   addCustomBtn: { backgroundColor:COLORS.blue, padding:10, borderRadius:4, justifyContent:'center', alignItems:'center' },
//   cancelBtn: { flex:1, padding:15, alignItems:'center', marginRight:10 },
//   saveBtn: { flex:1, backgroundColor:COLORS.blue, padding:15, alignItems:'center', borderRadius:6 },
//   btnText: { color:COLORS.text, fontWeight:'bold' },
//   settingsSaveBtn: { backgroundColor:COLORS.blue, padding:18, borderRadius:8, alignItems:'center', marginTop:30 },
//   settingsSaveBtnText: { color:COLORS.white, fontWeight:'bold', fontSize:16, letterSpacing:1 },
//   settingsAvatar: { width:120, height:120, borderRadius:60, borderWidth:2, borderColor:COLORS.blue, marginBottom:10 },
//   editIconBadge: { position:'absolute', bottom:10, right:10, backgroundColor:COLORS.blue, width:30, height:30, borderRadius:15, justifyContent:'center', alignItems:'center', borderWidth:2, borderColor:COLORS.secondary },
//   statBoxLarge: { backgroundColor:COLORS.accent, padding:20, alignItems:'center', borderRadius:12, marginTop:20 },
//   bigStat: { color:COLORS.blue, fontSize:40, fontWeight:'bold' },
//   bigStatLbl: { color:COLORS.textDark, fontSize:12, letterSpacing:2 },
//   questPaperDark: { backgroundColor:COLORS.secondary, margin:20, padding:20, borderRadius:8, borderWidth:1, borderColor:COLORS.accent },
//   questTitleDark: { color:COLORS.text, fontSize:20, fontWeight:'bold', textAlign:'center' },
//   difficulty: { color:COLORS.gold, textAlign:'center', fontSize:12, marginBottom:10 },
//   objTitleDark: { color:COLORS.blue, fontWeight:'bold', marginTop:10 },
//   objRow: { flexDirection:'row', justifyContent:'space-between', marginTop:5 },
//   objTextDark: { color:COLORS.text },
//   objValDark: { color:COLORS.text, fontWeight:'bold' },
//   divider: { height:1, backgroundColor:COLORS.accent, marginVertical:10 },
//   rewardTitleDark: { color:COLORS.text, fontWeight:'bold' },
//   rewardText: { color:COLORS.blue, fontWeight:'bold' },
//   acceptBtn: { backgroundColor:COLORS.blue, margin:20, padding:15, borderRadius:8, alignItems:'center' },
//   acceptBtnText: { color:COLORS.primary, fontWeight:'bold', letterSpacing:2 },
//   settingRow: { flexDirection:'row', justifyContent:'space-between', paddingVertical:15, borderBottomWidth:1, borderBottomColor:COLORS.accent, alignItems:'center' },
//   settingText: { color:COLORS.text, fontSize:16 },
//   alertBox: { backgroundColor:COLORS.secondary, borderRadius:12, borderWidth:2, borderColor:COLORS.blue, padding:20, width:'100%' },
//   alertTitle: { color:COLORS.blue, fontSize:18, fontWeight:'bold', textAlign:'center', letterSpacing:1 },
//   alertMessage: { color:COLORS.text, textAlign:'center', marginVertical:15 },
//   alertButtons: { flexDirection:'row', justifyContent:'center', marginTop:10 },
//   alertButton: { paddingHorizontal:20, paddingVertical:10, borderRadius:6, minWidth:80, alignItems:'center', marginHorizontal:5 },
//   alertButtonDefault: { backgroundColor:COLORS.blue },
//   alertButtonDestructive: { backgroundColor:COLORS.danger },
//   alertButtonCancel: { backgroundColor:COLORS.accent },
//   alertButtonText: { color:COLORS.text, fontWeight:'bold', fontSize:12 },
//   timerCircle: { width:120, height:120, borderRadius:60, borderWidth:4, borderColor:COLORS.blue, justifyContent:'center', alignItems:'center', marginVertical:30 },
//   timerText: { fontSize:40, fontWeight:'bold', color:COLORS.white },
//   dayBtn: { width:35, height:35, borderRadius:17.5, backgroundColor:COLORS.secondary, justifyContent:'center', alignItems:'center', borderWidth:1, borderColor:COLORS.accent },
//   dayBtnActive: { backgroundColor:COLORS.blue, borderColor:COLORS.glow },
//   dayBtnText: { color:COLORS.textDark, fontSize:12, fontWeight:'bold' },
//   timerCtrlBtn: { flexDirection:'row', alignItems:'center', paddingHorizontal:20, paddingVertical:10, borderRadius:8, marginHorizontal:5 },
//   timerCtrlText: { color:COLORS.white, fontWeight:'bold', marginLeft:6, fontSize:13, letterSpacing:1 },
//   // Linked input display styles
//   linkedSegment: { alignItems:'center', backgroundColor:COLORS.accent, borderRadius:8, paddingVertical:8, paddingHorizontal:14, marginHorizontal:2 },
//   linkedLabel: { color:COLORS.textDark, fontSize:9, fontWeight:'bold', letterSpacing:1, marginBottom:2 },
//   linkedValue: { color:COLORS.white, fontSize:28, fontWeight:'900' },
//   linkedSep: { color:COLORS.blue, fontSize:28, fontWeight:'900', marginHorizontal:2, marginTop:8 },
//   // Numpad styles
//   numpadBtn: { width:72, height:50, backgroundColor:COLORS.accent, borderRadius:8, justifyContent:'center', alignItems:'center', marginHorizontal:5, borderWidth:1, borderColor:COLORS.secondary },
//   numpadText: { color:COLORS.white, fontSize:22, fontWeight:'bold' },
// });





// import { FontAwesome5, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
// import AsyncStorage from "@react-native-async-storage/async-storage";
// import Slider from "@react-native-community/slider";
// import { Audio } from "expo-av";
// import { CameraView, useCameraPermissions } from "expo-camera";
// import * as DocumentPicker from "expo-document-picker";
// import * as ImagePicker from "expo-image-picker";
// import React, { useEffect, useRef, useState } from "react";
// import { Animated, AppState, BackHandler, Dimensions, Image, Modal, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, Vibration, View } from "react-native";
// import { LineChart } from "react-native-chart-kit";
// import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

// const { width } = Dimensions.get('window');

// type GoalType = 'muscle' | 'weight_loss' | 'speed_strength';
// interface UserData { name: string; level: number; sex: 'male' | 'female'; weight: number; height: number; goal: GoalType; xp: number; totalWorkouts: number; createdAt: string; lastDailyQuestCompleted?: string; cameraEnabled: boolean; profileImage?: string; assessmentStats?: { [key: string]: number }; }
// interface Exercise { name: string; iconName: string; iconLib: 'Ionicons' | 'MaterialCommunityIcons' | 'FontAwesome5'; type?: 'reps' | 'duration' | 'distance'; custom?: boolean; }
// interface ExerciseConfig { [key: string]: Exercise; }
// interface Quest { title: string; difficulty: number; exercises: { [key: string]: number }; rewards: { xp: number; title: string }; customExercises?: ExerciseConfig; isDaily?: boolean; }
// interface TrainingResult { [key: string]: number; }
// interface TrainingHistory { date: string; quest: Quest; results: TrainingResult; xpGained: number; durationSeconds?: number; }
// interface MusicTrack { id: string; title: string; path: any; isLocal: boolean; isFavorite: boolean; artwork?: string; }
// interface CustomProgram { id: string; name: string; exercises: { [key: string]: number }; customExercises?: ExerciseConfig; schedule: string[]; createdAt: string; }
// interface AlertButton { text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive'; }
// interface CustomAlertState { visible: boolean; title: string; message: string; buttons: AlertButton[]; }
// interface CustomTimer { id: string; label: string; seconds: number; }
// type PlaybackMode = 'loop_all' | 'play_all' | 'loop_one' | 'play_one';

// const COLORS = { primary: '#050714', secondary: '#0F172A', accent: '#1E293B', highlight: '#2563EB', blue: '#3B82F6', lightBlue: '#60A5FA', purple: '#7C3AED', danger: '#EF4444', success: '#10B981', text: '#F8FAFC', textDark: '#94A3B8', glow: '#0EA5E9', gold: '#F59E0B', white: '#FFFFFF' };
// const XP_PER_LEVEL_BASE = 600;
// const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// const EXERCISES: ExerciseConfig = {
//   squats: { name: 'Squats', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   pushups: { name: 'Push-ups', iconName: 'human-handsup', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   situps: { name: 'Sit-ups', iconName: 'dumbbell', iconLib: 'FontAwesome5', type: 'reps' },
//   pullups: { name: 'Pull-ups', iconName: 'human-male-height', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   bicepCurls: { name: 'Bicep Curls', iconName: 'arm-flex', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   lunges: { name: 'Lunges', iconName: 'run', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   plank: { name: 'Plank (sec)', iconName: 'timer', iconLib: 'Ionicons', type: 'duration' },
//   running: { name: 'Running (km)', iconName: 'run-fast', iconLib: 'MaterialCommunityIcons', type: 'distance' },
//   clapPushups: { name: 'Clap Push-ups', iconName: 'flash', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   jumpSquats: { name: 'Jump Squats', iconName: 'arrow-up-bold-circle', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   burpees: { name: 'Burpees', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
// };

// class PoseCalculator {
//   static calculateAngle(a: {x:number,y:number}, b: {x:number,y:number}, c: {x:number,y:number}) { const radians = Math.atan2(c.y-b.y,c.x-b.x)-Math.atan2(a.y-b.y,a.x-b.x); let angle = Math.abs(radians*180.0/Math.PI); if(angle>180.0) angle=360-angle; return angle; }
//   static detectSquat(landmarks: any): { angle: number } { return { angle: 0 }; }
//   static isSupported(exerciseKey: string): boolean { return ['squats','pushups','situps','bicepCurls','lifting'].includes(exerciseKey); }
// }

// const SYSTEM_SOUND = require('../assets/audio/solo_leveling_system.mp3');
// const DEFAULT_OST = require('../assets/audio/ost.mp3');
// const getDayString = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'short' });
// const getISODate = (date: Date) => date.toISOString().split('T')[0];
// const formatTime = (seconds: number) => { const m = Math.floor(seconds/60); const s = Math.floor(seconds%60); return `${m}:${s<10?'0':''}${s}`; };
// const pad2 = (n: number) => n < 10 ? `0${n}` : `${n}`;
// const pad3 = (n: number) => n < 10 ? `00${n}` : n < 100 ? `0${n}` : `${n}`;

// // Stopwatch display: ms precision, auto-expands to hours/days
// const formatStopwatch = (totalMs: number) => {
//   const ms = totalMs % 1000; const totalSec = Math.floor(totalMs/1000); const sec = totalSec%60;
//   const totalMin = Math.floor(totalSec/60); const min = totalMin%60;
//   const totalHr = Math.floor(totalMin/60); const hr = totalHr%24; const days = Math.floor(totalHr/24);
//   if (days > 0) return `${days}d ${pad2(hr)}:${pad2(min)}:${pad2(sec)}.${pad3(ms)}`;
//   if (hr > 0) return `${pad2(hr)}:${pad2(min)}:${pad2(sec)}.${pad3(ms)}`;
//   return `${pad2(min)}:${pad2(sec)}.${pad3(ms)}`;
// };

// // Countdown display with hours support
// const formatCountdown = (totalSec: number) => {
//   const sec = totalSec%60; const totalMin = Math.floor(totalSec/60); const min = totalMin%60;
//   const totalHr = Math.floor(totalMin/60); const hr = totalHr%24; const days = Math.floor(totalHr/24);
//   if (days > 0) return `${days}d ${pad2(hr)}:${pad2(min)}:${pad2(sec)}`;
//   if (hr > 0) return `${pad2(hr)}:${pad2(min)}:${pad2(sec)}`;
//   return `${pad2(min)}:${pad2(sec)}`;
// };

// // Linked digit parser: 6 slots [H,H,M,M,S,S] right-to-left entry like a calculator
// const parseLinkedDigits = (digits: string[]): { hours: number; minutes: number; seconds: number } => {
//   const h = parseInt(digits.slice(0,2).join(''))||0;
//   const m = parseInt(digits.slice(2,4).join(''))||0;
//   const s = parseInt(digits.slice(4,6).join(''))||0;
//   return { hours: Math.min(h,99), minutes: Math.min(m,59), seconds: Math.min(s,59) };
// };

// const SoloIcon = ({ name, lib, size = 24, color = COLORS.text }: { name: string, lib: string, size?: number, color?: string }) => {
//   if (lib==='Ionicons') return <Ionicons name={name as any} size={size} color={color} />;
//   if (lib==='MaterialCommunityIcons') return <MaterialCommunityIcons name={name as any} size={size} color={color} />;
//   if (lib==='FontAwesome5') return <FontAwesome5 name={name as any} size={size} color={color} />;
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
//               <TouchableOpacity key={index} style={[styles.alertButton, btn.style==='destructive'?styles.alertButtonDestructive:btn.style==='cancel'?styles.alertButtonCancel:styles.alertButtonDefault]} onPress={() => { if(btn.onPress) btn.onPress(); onClose(); }}>
//                 <Text style={styles.alertButtonText}>{btn.text}</Text>
//               </TouchableOpacity>
//             ))}
//           </View>
//         </View>
//       </View>
//     </Modal>
//   );
// };

// export default function SoloLevelingFitnessTracker(): JSX.Element {
//   const [screen, setScreenState] = useState<string>('loading');
//   const [userData, setUserData] = useState<UserData | null>(null);
//   const [customPrograms, setCustomPrograms] = useState<CustomProgram[]>([]);
//   const [alertState, setAlertState] = useState<CustomAlertState>({ visible: false, title: '', message: '', buttons: [] });
//   const [playlist, setPlaylist] = useState<MusicTrack[]>([]);
//   const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
//   const [sound, setSound] = useState<Audio.Sound | null>(null);
//   const [isPlaying, setIsPlaying] = useState(false);
//   const [musicLoading, setMusicLoading] = useState(false);
//   const [position, setPosition] = useState(0);
//   const [duration, setDuration] = useState(0);
//   const [isMuted, setIsMuted] = useState(false);
//   const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('loop_all');
//   const playlistRef = useRef<MusicTrack[]>([]); const currentTrackRef = useRef<MusicTrack | null>(null); const playbackModeRef = useRef<PlaybackMode>('loop_all');
//   useEffect(() => { playlistRef.current = playlist; }, [playlist]);
//   useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
//   useEffect(() => { playbackModeRef.current = playbackMode; }, [playbackMode]);
//   const [systemSoundObj, setSystemSoundObj] = useState<Audio.Sound | null>(null);
//   const [currentQuest, setCurrentQuest] = useState<Quest | null>(null);
//   const [isTraining, setIsTraining] = useState<boolean>(false);

//   const playSystemSound = async () => {
//     try {
//       if (systemSoundObj) await systemSoundObj.unloadAsync();
//       if (sound && isPlaying) await sound.setVolumeAsync(0.1);
//       const { sound: newSysSound } = await Audio.Sound.createAsync(SYSTEM_SOUND);
//       setSystemSoundObj(newSysSound);
//       await newSysSound.playAsync();
//       newSysSound.setOnPlaybackStatusUpdate(async (status) => { if(status.isLoaded&&status.didJustFinish) { await newSysSound.unloadAsync(); setSystemSoundObj(null); if(sound&&isPlaying) await sound.setVolumeAsync(1.0); } });
//     } catch (error) { console.log('System sound error', error); }
//   };

//   const navigateTo = (newScreen: string) => { if(newScreen!==screen) { playSystemSound(); setScreenState(newScreen); } };
//   const showAlert = (title: string, message: string, buttons: AlertButton[] = [{ text: 'OK' }]) => { setAlertState({ visible: true, title, message, buttons }); };
//   const closeAlert = () => { setAlertState(prev => ({ ...prev, visible: false })); };

//   useEffect(() => {
//     const backAction = () => {
//       if (systemSoundObj) { try { systemSoundObj.stopAsync(); systemSoundObj.unloadAsync(); setSystemSoundObj(null); } catch(e) {} }
//       if (screen==='dashboard'||screen==='loading'||screen==='setup') return false;
//       if (screen==='training') { showAlert("Abort Mission?","Stop training?",[{text:"Cancel",style:"cancel"},{text:"Quit",style:"destructive",onPress:()=>navigateTo('dashboard')}]); return true; }
//       navigateTo('dashboard'); return true;
//     };
//     const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
//     return () => backHandler.remove();
//   }, [screen, systemSoundObj]);

//   useEffect(() => {
//     async function init() {
//       try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false, staysActiveInBackground: true, playsInSilentModeIOS: true, shouldDuckAndroid: true, playThroughEarpieceAndroid: false }); } catch(e) { console.warn("Audio Mode Config Error:",e); }
//       try {
//         const stored = await AsyncStorage.getItem('musicPlaylist');
//         const defaultTrack: MusicTrack = { id: 'default_ost', title: 'System Soundtrack (Default)', path: DEFAULT_OST, isLocal: true, isFavorite: true };
//         let tracks: MusicTrack[] = [defaultTrack];
//         if (stored) { const parsed = JSON.parse(stored); tracks = [...tracks, ...parsed.filter((t: MusicTrack) => t.id!=='default_ost')]; }
//         setPlaylist(tracks);
//       } catch(e) { console.error("Audio Init Error",e); }
//       playSystemSound();
//       const progData = await AsyncStorage.getItem('customPrograms');
//       const loadedPrograms: CustomProgram[] = progData ? JSON.parse(progData) : [];
//       setCustomPrograms(loadedPrograms);
//       const data = await AsyncStorage.getItem('userData');
//       if (data) { let user: UserData = JSON.parse(data); user = await checkPenalties(user, loadedPrograms); setUserData(user); setScreenState('dashboard'); } else { setScreenState('setup'); }
//     }
//     init();
//     return () => { if(sound) sound.unloadAsync(); if(systemSoundObj) systemSoundObj.unloadAsync(); };
//   }, []);

//   const checkPenalties = async (user: UserData, programs: CustomProgram[]): Promise<UserData> => {
//     if (!user.lastDailyQuestCompleted) { const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1); user.lastDailyQuestCompleted = getISODate(yesterday); await AsyncStorage.setItem('userData', JSON.stringify(user)); return user; }
//     const lastDate = new Date(user.lastDailyQuestCompleted); const today = new Date(); const todayStr = getISODate(today);
//     if (user.lastDailyQuestCompleted===todayStr) return user;
//     let penaltyXP = 0; let missedDays = 0;
//     const checkDate = new Date(lastDate); checkDate.setDate(checkDate.getDate()+1);
//     const historyData = await AsyncStorage.getItem('trainingHistory'); const history: TrainingHistory[] = historyData ? JSON.parse(historyData) : []; let historyChanged = false;
//     while (getISODate(checkDate)<todayStr) {
//       const dailyPenaltyAmount = user.level*100; penaltyXP += dailyPenaltyAmount; missedDays++;
//       history.push({ date: checkDate.toISOString(), quest: { title:"PENALTY: MISSED QUEST", difficulty:0, exercises:{}, rewards:{xp:0,title:'None'} }, results:{}, xpGained:-dailyPenaltyAmount, durationSeconds:0 });
//       historyChanged = true; checkDate.setDate(checkDate.getDate()+1);
//     }
//     if (penaltyXP>0) {
//       let newXP = user.xp-penaltyXP; let newLevel = user.level;
//       while (newXP<0) { if(newLevel>1) { newLevel--; newXP = newLevel*XP_PER_LEVEL_BASE+newXP; } else { newXP=0; break; } }
//       user.xp = newXP; user.level = newLevel;
//       const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1); user.lastDailyQuestCompleted = getISODate(yesterday);
//       showAlert("PENALTY SYSTEM",`You failed to complete daily quests for ${missedDays} day(s).\n\nPUNISHMENT: -${penaltyXP} XP.`);
//       await AsyncStorage.setItem('userData', JSON.stringify(user));
//       if (historyChanged) await AsyncStorage.setItem('trainingHistory', JSON.stringify(history));
//     }
//     return user;
//   };

//   useEffect(() => {
//     let interval: NodeJS.Timeout;
//     if (sound&&isPlaying) { interval = setInterval(async () => { try { const status = await sound.getStatusAsync(); if(status.isLoaded) { setPosition(status.positionMillis/1000); setDuration(status.durationMillis?status.durationMillis/1000:1); } } catch(e) {} }, 1000); }
//     return () => clearInterval(interval);
//   }, [sound, isPlaying]);

//   const handleAutoNext = async (currentSound: Audio.Sound) => {
//     const list = playlistRef.current; const curr = currentTrackRef.current; const mode = playbackModeRef.current;
//     if (!curr||list.length===0) return;
//     if (mode==='loop_one') await currentSound.replayAsync();
//     else if (mode==='play_one') { setIsPlaying(false); setPosition(0); await currentSound.stopAsync(); await currentSound.setPositionAsync(0); }
//     else if (mode==='play_all') { const idx=list.findIndex(t=>t.id===curr.id); if(idx!==-1&&idx<list.length-1) playTrack(list[idx+1]); else { setIsPlaying(false); setPosition(0); await currentSound.stopAsync(); await currentSound.setPositionAsync(0); } }
//     else if (mode==='loop_all') { const idx=list.findIndex(t=>t.id===curr.id); playTrack(list[(idx+1)%list.length]); }
//   };

//   const saveUserData = async (data: UserData) => { await AsyncStorage.setItem('userData', JSON.stringify(data)); setUserData(data); };
//   const updateCustomPrograms = async (programs: CustomProgram[]) => { setCustomPrograms(programs); await AsyncStorage.setItem('customPrograms', JSON.stringify(programs)); };

//   const playTrack = async (track: MusicTrack) => {
//     if (musicLoading) return;
//     if (currentTrack?.id===track.id&&sound) { const status = await sound.getStatusAsync(); if(status.isLoaded&&!status.isPlaying) { await sound.playAsync(); setIsPlaying(true); return; } }
//     try {
//       setMusicLoading(true);
//       if (sound) { await sound.unloadAsync(); setSound(null); }
//       const source = track.isLocal ? track.path : { uri: track.path };
//       const shouldLoop = playbackModeRef.current==='loop_one';
//       const { sound: newSound } = await Audio.Sound.createAsync(source, { shouldPlay: true, isLooping: shouldLoop });
//       newSound.setOnPlaybackStatusUpdate((status) => { if(status.isLoaded&&status.didJustFinish&&!status.isLooping) handleAutoNext(newSound); });
//       if (isMuted) await newSound.setIsMutedAsync(true);
//       setSound(newSound); setCurrentTrack(track); setIsPlaying(true); setMusicLoading(false);
//     } catch (error) { console.log('Play Error',error); setMusicLoading(false); showAlert('Error','Could not play audio track.'); }
//   };

//   const togglePlayPause = async () => { if(!sound) { if(playlist.length>0) playTrack(playlist[0]); return; } if(musicLoading) return; if(isPlaying) { await sound.pauseAsync(); setIsPlaying(false); } else { await sound.playAsync(); setIsPlaying(true); } };
//   const seekTrack = async (value: number) => { if(sound&&!musicLoading) { await sound.setPositionAsync(value*1000); setPosition(value); } };
//   const skipToNext = () => { if(!currentTrack||playlist.length===0) return; const idx=playlist.findIndex(t=>t.id===currentTrack.id); playTrack(playlist[(idx+1)%playlist.length]); };
//   const skipToPrev = () => { if(!currentTrack||playlist.length===0) return; const idx=playlist.findIndex(t=>t.id===currentTrack.id); playTrack(playlist[idx===0?playlist.length-1:idx-1]); };
//   const deleteTrack = async (trackId: string) => { if(trackId==='default_ost') return; if(currentTrack?.id===trackId) { if(sound) await sound.unloadAsync(); setSound(null); setCurrentTrack(null); setIsPlaying(false); } const newList=playlist.filter(t=>t.id!==trackId); setPlaylist(newList); AsyncStorage.setItem('musicPlaylist',JSON.stringify(newList)); };
//   const addMusicFile = async () => { try { const result = await DocumentPicker.getDocumentAsync({type:'audio/*'}); if(!result.canceled&&result.assets&&result.assets.length>0) { const file=result.assets[0]; const newTrack: MusicTrack={id:Date.now().toString(),title:file.name,path:file.uri,isLocal:false,isFavorite:false}; const newList=[...playlist,newTrack]; setPlaylist(newList); AsyncStorage.setItem('musicPlaylist',JSON.stringify(newList)); } } catch(e) { showAlert('Error','Failed to pick audio file'); } };

//   const MiniPlayer = () => {
//     if (!currentTrack) return null;
//     return (
//       <TouchableOpacity activeOpacity={0.9} onPress={() => navigateTo('music')} style={styles.miniPlayerContainer}>
//         <View style={styles.miniProgressContainer}><View style={[styles.miniProgressFill,{width:`${(position/(duration||1))*100}%`}]} /></View>
//         <View style={styles.miniPlayerContent}>
//           <View style={styles.miniInfo}>
//             {currentTrack.artwork?(<Image source={{uri:currentTrack.artwork}} style={styles.miniArt}/>):(<Ionicons name="musical-note" size={20} color={COLORS.blue} style={{marginRight:10}}/>)}
//             <View><Text style={styles.miniTitle} numberOfLines={1}>{currentTrack.title}</Text><Text style={styles.miniTime}>{formatTime(position)} / {formatTime(duration)}</Text></View>
//           </View>
//           <View style={styles.miniControls}>
//             <TouchableOpacity onPress={(e)=>{e.stopPropagation();skipToPrev();}} style={styles.miniCtrlBtn}><Ionicons name="play-skip-back" size={20} color={COLORS.text}/></TouchableOpacity>
//             <TouchableOpacity onPress={(e)=>{e.stopPropagation();togglePlayPause();}} style={styles.miniCtrlBtn}><Ionicons name={isPlaying?"pause":"play"} size={26} color={COLORS.white}/></TouchableOpacity>
//             <TouchableOpacity onPress={(e)=>{e.stopPropagation();skipToNext();}} style={styles.miniCtrlBtn}><Ionicons name="play-skip-forward" size={20} color={COLORS.text}/></TouchableOpacity>
//           </View>
//         </View>
//       </TouchableOpacity>
//     );
//   };

//   const renderScreen = () => {
//     if (!userData&&screen!=='loading'&&screen!=='setup') return <LoadingScreen />;
//     switch (screen) {
//       case 'loading': return <LoadingScreen />;
//       case 'setup': return <SetupScreen onComplete={(data) => { setUserData(data); setScreenState('assessment'); }} />;
//       case 'assessment': return <AssessmentScreen userData={userData!} onComplete={(stats, calculatedLevel) => { const finalData={...userData!,level:calculatedLevel,assessmentStats:stats,createdAt:new Date().toISOString(),lastDailyQuestCompleted:getISODate(new Date())}; saveUserData(finalData); navigateTo('dashboard'); }} />;
//       case 'dashboard': return <DashboardScreen userData={userData!} onNavigate={navigateTo} onStartQuest={() => navigateTo('quest')} />;
//       case 'quest': return <QuestScreen userData={userData!} customPrograms={customPrograms} onBack={() => navigateTo('dashboard')} onStartTraining={(quest) => { setCurrentQuest(quest); setIsTraining(true); navigateTo('training'); }} />;
//       case 'training': return <TrainingScreen userData={userData!} quest={currentQuest!} showAlert={showAlert} onComplete={(results, duration) => { updateProgress(results, duration); navigateTo('dashboard'); }} onBack={() => { showAlert("Abort Mission?","Stop training?",[{text:"Cancel",style:"cancel"},{text:"Quit",style:"destructive",onPress:()=>navigateTo('dashboard')}]); }} />;
//       case 'stats': return <StatsScreen userData={userData!} onBack={() => navigateTo('dashboard')} />;
//       case 'music': return <MusicScreen playlist={playlist} currentTrack={currentTrack} isPlaying={isPlaying} isLoading={musicLoading} position={position} duration={duration} playbackMode={playbackMode} onPlay={playTrack} onPause={togglePlayPause} onSeek={seekTrack} onNext={skipToNext} onPrev={skipToPrev} onDelete={deleteTrack} onAdd={addMusicFile} onToggleMode={async () => { const modes: PlaybackMode[]=['loop_all','play_all','loop_one','play_one']; const nextMode=modes[(modes.indexOf(playbackMode)+1)%modes.length]; setPlaybackMode(nextMode); if(sound) await sound.setIsLoopingAsync(nextMode==='loop_one'); }} onBack={() => navigateTo('dashboard')} />;
//       case 'programs': return <CustomProgramsScreen userData={userData!} customPrograms={customPrograms} setCustomPrograms={updateCustomPrograms} onBack={() => navigateTo('dashboard')} onStartProgram={(quest) => { setCurrentQuest(quest); setIsTraining(true); navigateTo('training'); }} showAlert={showAlert} />;
//       case 'settings': return <SettingsScreen userData={userData!} onSave={(data) => { saveUserData(data); navigateTo('dashboard'); }} onBack={() => navigateTo('dashboard')} />;
//       case 'timers': return <TimersScreen onBack={() => navigateTo('dashboard')} />;
//       default: return <LoadingScreen />;
//     }
//   };

//   const updateProgress = async (results: TrainingResult, duration: number) => {
//     try {
//       let xpGained = currentQuest?.isDaily ? currentQuest.rewards.xp : 100;
//       if (currentQuest?.isDaily) { userData!.lastDailyQuestCompleted = getISODate(new Date()); }
//       const history = await AsyncStorage.getItem('trainingHistory'); const parsed: TrainingHistory[] = history ? JSON.parse(history) : [];
//       parsed.push({ date: new Date().toISOString(), quest: currentQuest!, results, xpGained, durationSeconds: duration });
//       await AsyncStorage.setItem('trainingHistory', JSON.stringify(parsed));
//       const xpNeeded = userData!.level*XP_PER_LEVEL_BASE; let newTotalXP = userData!.xp+xpGained; let newLevel = userData!.level; let leveledUp = false;
//       while (newTotalXP>=xpNeeded) { newTotalXP -= xpNeeded; newLevel++; leveledUp = true; }
//       const newUserData: UserData = { ...userData!, xp: newTotalXP, level: newLevel, totalWorkouts: (userData!.totalWorkouts||0)+1 };
//       if (leveledUp) showAlert('LEVEL UP!',`You have reached Level ${newLevel}!`); else showAlert('QUEST COMPLETED',`You gained ${xpGained} Experience Points.`);
//       saveUserData(newUserData);
//     } catch (error) { console.error('Error updating progress:',error); }
//   };

//   return (
//     <SafeAreaProvider>
//       <SafeAreaView style={styles.container} edges={['top','bottom']}>
//         <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} translucent={false} />
//         <View style={{ flex: 1 }}>{renderScreen()}</View>
//         {currentTrack&&screen!=='music'&&<MiniPlayer />}
//         <CustomAlert {...alertState} onClose={closeAlert} />
//       </SafeAreaView>
//     </SafeAreaProvider>
//   );
// }

// // --- Screens ---

// function LoadingScreen() {
//   const spinValue = useRef(new Animated.Value(0)).current;
//   useEffect(() => { Animated.loop(Animated.timing(spinValue,{toValue:1,duration:2000,useNativeDriver:true})).start(); }, []);
//   const spin = spinValue.interpolate({inputRange:[0,1],outputRange:['0deg','360deg']});
//   return (<View style={styles.centerContainer}><Animated.View style={{transform:[{rotate:spin}],marginBottom:20}}><Ionicons name="reload-circle-outline" size={60} color={COLORS.blue}/></Animated.View><Text style={styles.loadingTitle}>SOLO LEVELING</Text><Text style={styles.loadingSubtitle}>INITIALIZING SYSTEM...</Text></View>);
// }

// function SetupScreen({ onComplete }: { onComplete: (data: UserData) => void }) {
//   const [formData, setFormData] = useState<any>({ name:'', level:1, sex:'male', weight:'', height:'', goal:'muscle' });
//   const [image, setImage] = useState<string | null>(null);
//   const pickImage = async () => { let result = await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Images,allowsEditing:true,aspect:[1,1],quality:0.5}); if(!result.canceled) setImage(result.assets[0].uri); };
//   const handleNext = () => { if(!formData.name) return; onComplete({...formData,weight:parseFloat(formData.weight)||70,height:parseFloat(formData.height)||170,xp:0,totalWorkouts:0,createdAt:new Date().toISOString(),cameraEnabled:false,profileImage:image||undefined}); };
//   const GoalButton = ({ type, icon, label }: { type: GoalType, icon: string, label: string }) => (<TouchableOpacity style={[styles.goalBtn,formData.goal===type&&styles.goalBtnActive]} onPress={() => setFormData({...formData,goal:type})}><MaterialCommunityIcons name={icon as any} size={24} color={formData.goal===type?COLORS.white:COLORS.blue}/><Text style={formData.goal===type?styles.goalTextActive:styles.goalText}>{label}</Text></TouchableOpacity>);
//   return (
//     <ScrollView style={styles.screenContainer} contentContainerStyle={{padding:20}} showsVerticalScrollIndicator={false}>
//       <Text style={styles.headerTitle}>PLAYER REGISTRATION</Text>
//       <TouchableOpacity onPress={pickImage} style={styles.avatarPicker}>{image?(<Image source={{uri:image}} style={styles.avatarImage}/>):(<View style={styles.avatarPlaceholder}><Ionicons name="camera" size={40} color={COLORS.textDark}/><Text style={styles.avatarText}>ADD PHOTO</Text></View>)}</TouchableOpacity>
//       <View style={styles.formGroup}><Text style={styles.label}>HUNTER NAME</Text><TextInput style={styles.input} placeholder="Enter Name" placeholderTextColor={COLORS.textDark} onChangeText={t=>setFormData({...formData,name:t})}/></View>
//       <View style={styles.formGroup}><Text style={styles.label}>GOAL / CLASS</Text><GoalButton type="muscle" icon="arm-flex" label="Muscle & Strength"/><GoalButton type="weight_loss" icon="run-fast" label="Weight Loss"/><GoalButton type="speed_strength" icon="flash" label="Speed & Strength (Assassin)"/></View>
//       <View style={styles.formGroup}><Text style={styles.label}>GENDER</Text><View style={styles.genderContainer}><TouchableOpacity style={[styles.genderBtn,formData.sex==='male'&&styles.genderBtnActive]} onPress={() => setFormData({...formData,sex:'male'})}><Ionicons name="male" size={20} color={formData.sex==='male'?COLORS.white:COLORS.blue}/><Text style={formData.sex==='male'?styles.genderTextActive:styles.genderText}>MALE</Text></TouchableOpacity><TouchableOpacity style={[styles.genderBtn,formData.sex==='female'&&styles.genderBtnActive]} onPress={() => setFormData({...formData,sex:'female'})}><Ionicons name="female" size={20} color={formData.sex==='female'?COLORS.white:COLORS.blue}/><Text style={formData.sex==='female'?styles.genderTextActive:styles.genderText}>FEMALE</Text></TouchableOpacity></View></View>
//       <View style={styles.row}><View style={[styles.formGroup,{flex:1,marginRight:10}]}><Text style={styles.label}>WEIGHT (KG)</Text><TextInput style={styles.input} keyboardType="numeric" onChangeText={t=>setFormData({...formData,weight:t})}/></View><View style={[styles.formGroup,{flex:1}]}><Text style={styles.label}>HEIGHT (CM)</Text><TextInput style={styles.input} keyboardType="numeric" onChangeText={t=>setFormData({...formData,height:t})}/></View></View>
//       <TouchableOpacity style={styles.mainButton} onPress={handleNext}><Text style={styles.mainButtonText}>PROCEED TO EVALUATION</Text></TouchableOpacity>
//     </ScrollView>
//   );
// }

// function AssessmentScreen({ userData, onComplete }: { userData: UserData, onComplete: (stats: any, level: number) => void }) {
//   const [step, setStep] = useState<'intro'|'active'|'rest'|'input'>('intro');
//   const [currentExIndex, setCurrentExIndex] = useState(0);
//   const [timer, setTimer] = useState(0);
//   const [reps, setReps] = useState('');
//   const [results, setResults] = useState<{[key:string]:number}>({});
//   const appStateRef = useRef(AppState.currentState);
//   const bgStartTimeRef = useRef<number | null>(null);

//   useEffect(() => {
//     const sub = AppState.addEventListener('change', nextState => {
//       if (appStateRef.current.match(/active/)&&nextState==='background') { bgStartTimeRef.current = Date.now(); }
//       if (appStateRef.current==='background'&&nextState==='active') { if(bgStartTimeRef.current!==null) { const elapsed=Math.floor((Date.now()-bgStartTimeRef.current)/1000); bgStartTimeRef.current=null; setTimer(prev=>Math.max(0,prev-elapsed)); } }
//       appStateRef.current = nextState;
//     });
//     return () => sub.remove();
//   }, []);

//   const getExercises = () => { if(userData.goal==='speed_strength') return ['pushups','jumpSquats','lunges']; else if(userData.goal==='weight_loss') return ['squats','situps','lunges']; else return ['pushups','squats','situps']; };
//   const exercises = getExercises(); const currentEx = exercises[currentExIndex]; const EX_TIME = 60; const REST_TIME = 15;

//   useEffect(() => {
//     let interval: NodeJS.Timeout;
//     if ((step==='active'||step==='rest')&&timer>0) {
//       interval = setInterval(() => {
//         setTimer(prev => {
//           if (prev<=1) {
//             if (step==='active') { Vibration.vibrate(); setStep('input'); }
//             else if (step==='rest') { if(currentExIndex<exercises.length-1) { setCurrentExIndex(prevIdx=>prevIdx+1); startExercise(); } else { finishAssessment(); } }
//             return 0;
//           }
//           return prev-1;
//         });
//       }, 1000);
//     }
//     return () => clearInterval(interval);
//   }, [step, timer]);

//   const startExercise = () => { setTimer(EX_TIME); setStep('active'); setReps(''); };
//   const handleInput = () => { const count=parseInt(reps)||0; setResults(prev=>({...prev,[currentEx]:count})); if(currentExIndex<exercises.length-1) { setTimer(REST_TIME); setStep('rest'); } else { finishAssessment(count); } };
//   const finishAssessment = (lastReps?: number) => { const finalResults=lastReps?{...results,[currentEx]:lastReps}:results; let totalReps=0; Object.values(finalResults).forEach(val=>totalReps+=val); const calculatedLevel=Math.max(1,Math.floor(totalReps/40)+1); onComplete(finalResults,calculatedLevel); };

//   return (
//     <View style={styles.centerContainer}>
//       <Text style={styles.headerTitle}>SYSTEM EVALUATION</Text>
//       {step==='intro'&&(<View style={{padding:20,alignItems:'center'}}><Text style={styles.questTitleDark}>RANKING TEST</Text><Text style={styles.alertMessage}>You will perform 3 exercises to determine your Hunter Rank. {"\n\n"}1 Minute MAX reps for each.{"\n"}15 Seconds rest between sets.</Text>{exercises.map(e=>(<View key={e} style={{flexDirection:'row',marginVertical:5}}><SoloIcon name={EXERCISES[e].iconName} lib={EXERCISES[e].iconLib} color={COLORS.blue}/><Text style={{color:COLORS.text,marginLeft:10}}>{EXERCISES[e].name}</Text></View>))}<TouchableOpacity style={styles.mainButton} onPress={startExercise}><Text style={styles.mainButtonText}>START TEST</Text></TouchableOpacity></View>)}
//       {step==='active'&&(
//         <View style={{alignItems:'center'}}>
//           <Text style={styles.loadingSubtitle}>CURRENT EXERCISE</Text><Text style={styles.loadingTitle}>{EXERCISES[currentEx].name}</Text>
//           <View style={styles.timerCircle}><Text style={styles.timerText}>{timer}</Text></View>
//           <Text style={styles.label}>DO AS MANY AS YOU CAN</Text>
//           <TouchableOpacity style={[styles.mainButton,{backgroundColor:COLORS.accent,marginTop:15,paddingHorizontal:30}]} onPress={() => { Vibration.vibrate(); setTimer(0); setStep('input'); }}>
//             <Text style={[styles.mainButtonText,{color:COLORS.gold}]}>SKIP (ENTER RESULT)</Text>
//           </TouchableOpacity>
//         </View>
//       )}
//       {step==='input'&&(<View style={{alignItems:'center',width:'80%'}}><Text style={styles.questTitleDark}>TIME'S UP</Text><Text style={styles.label}>ENTER REPS COMPLETED:</Text><TextInput style={[styles.input,{textAlign:'center',fontSize:24,width:100}]} keyboardType="numeric" value={reps} onChangeText={setReps} autoFocus/><TouchableOpacity style={styles.mainButton} onPress={handleInput}><Text style={styles.mainButtonText}>CONFIRM</Text></TouchableOpacity></View>)}
//       {step==='rest'&&(
//         <View style={{alignItems:'center'}}>
//           <Text style={styles.loadingTitle}>REST</Text><Text style={styles.timerText}>{timer}</Text><Text style={styles.loadingSubtitle}>NEXT: {EXERCISES[exercises[currentExIndex+1]]?.name}</Text>
//           <TouchableOpacity style={[styles.mainButton,{backgroundColor:COLORS.accent,marginTop:20,paddingHorizontal:30}]} onPress={() => { setTimer(0); if(currentExIndex<exercises.length-1) { setCurrentExIndex(prev=>prev+1); startExercise(); } else finishAssessment(); }}>
//             <Text style={[styles.mainButtonText,{color:COLORS.gold}]}>SKIP REST</Text>
//           </TouchableOpacity>
//         </View>
//       )}
//     </View>
//   );
// }

// function DashboardScreen({ userData, onNavigate, onStartQuest }: any) {
//   if (!userData) return null;
//   const xpPercent = (Math.max(0,userData.xp)/(userData.level*XP_PER_LEVEL_BASE))*100;
//   return (
//     <ScrollView style={styles.screenContainer} showsVerticalScrollIndicator={false}>
//       <View style={styles.dashboardHeader}>
//         <View style={styles.profileRow}>
//           <Image source={userData.profileImage?{uri:userData.profileImage}:{uri:'https://via.placeholder.com/150'}} style={styles.profileImageSmall}/>
//           <View><Text style={styles.playerName}>{userData.name}</Text><Text style={styles.playerRank}>LEVEL {userData.level}</Text><Text style={{color:COLORS.gold,fontSize:10,letterSpacing:1}}>CLASS: {userData.goal.replace('_',' ').toUpperCase()}</Text></View>
//         </View>
//       </View>
//       <View style={styles.systemWindow}>
//         <Text style={styles.systemHeader}>STATUS</Text>
//         <View style={styles.xpBarContainer}><View style={[styles.xpBarFill,{width:`${xpPercent}%`}]}/></View>
//         <Text style={styles.xpText}>{userData.xp} / {userData.level*XP_PER_LEVEL_BASE} XP</Text>
//         <View style={styles.statGrid}>
//           <View style={styles.statItem}><Ionicons name="barbell-outline" size={20} color={COLORS.blue}/><Text style={styles.statVal}>{userData.totalWorkouts}</Text><Text style={styles.statLbl}>Raids</Text></View>
//           <View style={styles.statItem}><MaterialCommunityIcons name="fire" size={20} color={COLORS.danger}/><Text style={styles.statVal}>{userData.level}</Text><Text style={styles.statLbl}>Rank</Text></View>
//         </View>
//       </View>
//       <View style={styles.menuGrid}>
//         <TouchableOpacity style={styles.menuCardLarge} onPress={onStartQuest}><MaterialCommunityIcons name="sword-cross" size={40} color={COLORS.gold}/><Text style={styles.menuTitle}>DAILY QUEST</Text><Text style={styles.menuSub}>{userData.lastDailyQuestCompleted===getISODate(new Date())?'Completed':'Available'}</Text></TouchableOpacity>
//         <View style={styles.menuRow}>
//           <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('programs')}><Ionicons name="list" size={24} color={COLORS.blue}/><Text style={styles.menuTitleSmall}>Programs</Text></TouchableOpacity>
//           <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('stats')}><Ionicons name="stats-chart" size={24} color={COLORS.success}/><Text style={styles.menuTitleSmall}>Stats</Text></TouchableOpacity>
//         </View>
//         <View style={styles.menuRow}>
//           <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('music')}><Ionicons name="musical-notes" size={24} color={COLORS.purple}/><Text style={styles.menuTitleSmall}>Music</Text></TouchableOpacity>
//           <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('timers')}><Ionicons name="timer-outline" size={24} color={COLORS.gold}/><Text style={styles.menuTitleSmall}>Timers</Text></TouchableOpacity>
//         </View>
//         <View style={styles.menuRow}>
//           <TouchableOpacity style={[styles.menuCardSmall,{width:'100%'}]} onPress={() => onNavigate('settings')}><Ionicons name="settings" size={24} color={COLORS.textDark}/><Text style={styles.menuTitleSmall}>Settings</Text></TouchableOpacity>
//         </View>
//       </View>
//     </ScrollView>
//   );
// }

// // --- Stopwatch Component ---
// function Stopwatch() {
//   const [elapsedMs, setElapsedMs] = useState(0);
//   const [running, setRunning] = useState(false);
//   const startTimeRef = useRef<number | null>(null);
//   const accumulatedRef = useRef(0);
//   const intervalRef = useRef<NodeJS.Timeout | null>(null);
//   const appStateRef = useRef(AppState.currentState);

//   useEffect(() => {
//     const sub = AppState.addEventListener('change', nextState => {
//       if (appStateRef.current.match(/active/)&&nextState==='background'&&running) { if(startTimeRef.current!==null) { accumulatedRef.current += Date.now()-startTimeRef.current; startTimeRef.current = null; } }
//       if (appStateRef.current==='background'&&nextState==='active'&&running) { startTimeRef.current = Date.now(); }
//       appStateRef.current = nextState;
//     });
//     return () => sub.remove();
//   }, [running]);

//   const start = () => {
//     if (running) return;
//     startTimeRef.current = Date.now(); setRunning(true);
//     intervalRef.current = setInterval(() => { const base = startTimeRef.current ? Date.now()-startTimeRef.current : 0; setElapsedMs(accumulatedRef.current+base); }, 33);
//   };
//   const pause = () => {
//     if (!running) return;
//     if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
//     if (startTimeRef.current !== null) { accumulatedRef.current += Date.now()-startTimeRef.current; startTimeRef.current = null; }
//     setRunning(false);
//   };
//   const reset = () => {
//     if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
//     startTimeRef.current = null; accumulatedRef.current = 0; setElapsedMs(0); setRunning(false);
//   };
//   useEffect(() => { return () => { if(intervalRef.current) clearInterval(intervalRef.current); }; }, []);

//   const ms = elapsedMs%1000; const totalSec = Math.floor(elapsedMs/1000); const sec = totalSec%60;
//   const totalMin = Math.floor(totalSec/60); const min = totalMin%60;
//   const totalHr = Math.floor(totalMin/60); const hr = totalHr%24; const days = Math.floor(totalHr/24);
//   const showHours = totalHr > 0; const showDays = days > 0;

//   const ArcRing = ({ fill, color, label, value }: { fill: number; color: string; label: string; value: string }) => (
//     <View style={{alignItems:'center',marginHorizontal:5}}>
//       <View style={{width:50,height:50,borderRadius:25,justifyContent:'center',alignItems:'center'}}>
//         <View style={{position:'absolute',width:50,height:50,borderRadius:25,borderWidth:4,borderColor:COLORS.accent}}/>
//         <View style={{position:'absolute',width:50,height:50,borderRadius:25,borderWidth:4,borderColor:color,opacity:Math.max(0.15,fill),transform:[{rotate:`${-90+fill*360}deg`}]}}/>
//         <View style={{position:'absolute',width:34,height:34,borderRadius:17,backgroundColor:COLORS.secondary}}/>
//         <Text style={{color:COLORS.white,fontSize:11,fontWeight:'800',zIndex:2}}>{value}</Text>
//       </View>
//       <Text style={{color,fontSize:8,fontWeight:'bold',marginTop:3,letterSpacing:1}}>{label}</Text>
//     </View>
//   );

//   return (
//     <View style={{backgroundColor:COLORS.secondary,borderRadius:14,padding:16,marginBottom:20,borderWidth:1,borderColor:COLORS.purple}}>
//       <Text style={[styles.label,{color:COLORS.purple,marginBottom:12,textAlign:'center',letterSpacing:2}]}>STOPWATCH</Text>
//       <Text style={{color:COLORS.white,fontSize:30,fontWeight:'900',textAlign:'center',letterSpacing:2,marginBottom:14}}>
//         {showDays?`${days}d `:''}{showHours?`${pad2(hr)}:`:''}
//         {pad2(min)}:{pad2(sec)}<Text style={{fontSize:18,color:COLORS.textDark}}>.{pad3(ms)}</Text>
//       </Text>
//       <View style={{flexDirection:'row',justifyContent:'center',marginBottom:14}}>
//         {showDays&&<ArcRing fill={Math.min(days/6,1)} color={COLORS.gold} label="DAYS" value={`${days}`}/>}
//         {showHours&&<ArcRing fill={hr/23} color={COLORS.danger} label="HRS" value={pad2(hr)}/>}
//         <ArcRing fill={min/59} color={COLORS.blue} label="MIN" value={pad2(min)}/>
//         <ArcRing fill={sec/59} color={COLORS.success} label="SEC" value={pad2(sec)}/>
//         <ArcRing fill={ms/999} color={COLORS.purple} label="MS" value={pad3(ms)}/>
//       </View>
//       <View style={{flexDirection:'row',justifyContent:'center'}}>
//         <TouchableOpacity style={[styles.timerCtrlBtn,{backgroundColor:running?COLORS.accent:COLORS.purple,marginRight:10}]} onPress={running?pause:start}>
//           <Ionicons name={running?"pause":"play"} size={22} color={COLORS.white}/><Text style={styles.timerCtrlText}>{running?'PAUSE':'START'}</Text>
//         </TouchableOpacity>
//         <TouchableOpacity style={[styles.timerCtrlBtn,{backgroundColor:COLORS.accent}]} onPress={reset}>
//           <Ionicons name="refresh" size={22} color={COLORS.text}/><Text style={styles.timerCtrlText}>RESET</Text>
//         </TouchableOpacity>
//       </View>
//     </View>
//   );
// }

// // --- Timers Screen ---
// function TimersScreen({ onBack }: { onBack: () => void }) {
//   const [customTimers, setCustomTimers] = useState<CustomTimer[]>([]);
//   const [activeTimers, setActiveTimers] = useState<{[id:string]: number}>({});
//   const [runningTimers, setRunningTimers] = useState<{[id:string]: boolean}>({});
//   // Linked numpad input: 6 digit slots [H,H,M,M,S,S], right-to-left (calculator style)
//   const [digits, setDigits] = useState<string[]>(['0','0','0','0','0','0']);
//   const [newLabel, setNewLabel] = useState('');
//   const intervalsRef = useRef<{[id:string]: NodeJS.Timeout}>({});
//   const bgStartRef = useRef<{[id:string]: number}>({});
//   const appStateRef = useRef(AppState.currentState);

//   useEffect(() => {
//     AsyncStorage.getItem('customTimers').then(data => { if(data) { const timers: CustomTimer[] = JSON.parse(data); setCustomTimers(timers); const init: {[id:string]:number}={}; timers.forEach(t=>init[t.id]=t.seconds); setActiveTimers(init); } });
//   }, []);

//   useEffect(() => {
//     const sub = AppState.addEventListener('change', nextState => {
//       if (appStateRef.current.match(/active/)&&nextState==='background') { Object.keys(runningTimers).forEach(id => { if(runningTimers[id]) bgStartRef.current[id]=Date.now(); }); }
//       if (appStateRef.current==='background'&&nextState==='active') {
//         const elapsed: {[id:string]:number}={};
//         Object.keys(bgStartRef.current).forEach(id => { elapsed[id]=Math.floor((Date.now()-bgStartRef.current[id])/1000); delete bgStartRef.current[id]; });
//         if (Object.keys(elapsed).length>0) setActiveTimers(prev => { const next={...prev}; Object.keys(elapsed).forEach(id => { next[id]=Math.max(0,(next[id]||0)-elapsed[id]); }); return next; });
//       }
//       appStateRef.current = nextState;
//     });
//     return () => sub.remove();
//   }, [runningTimers]);

//   const saveTimers = async (timers: CustomTimer[]) => { setCustomTimers(timers); await AsyncStorage.setItem('customTimers', JSON.stringify(timers)); };

//   // Push digit right, shift left (calculator numpad style)
//   const pushDigit = (d: string) => setDigits(prev => [...prev.slice(1), d]);
//   const clearDigits = () => setDigits(['0','0','0','0','0','0']);
//   const backspaceDigit = () => setDigits(prev => ['0', ...prev.slice(0,5)]);

//   const { hours, minutes, seconds } = parseLinkedDigits(digits);
//   const totalSeconds = hours*3600 + minutes*60 + seconds;

//   const addTimer = () => {
//     if (totalSeconds<=0) return;
//     const id = Date.now().toString();
//     const label = newLabel || `${hours>0?hours+'h ':''} ${minutes>0?minutes+'m ':''} ${seconds>0?seconds+'s':''}`.trim().replace(/\s+/g,' ');
//     const timer: CustomTimer = { id, label, seconds: totalSeconds };
//     const updated = [...customTimers, timer];
//     saveTimers(updated); setActiveTimers(prev => ({...prev,[id]:totalSeconds})); setNewLabel(''); clearDigits();
//   };

//   const deleteTimer = (id: string) => {
//     if (intervalsRef.current[id]) { clearInterval(intervalsRef.current[id]); delete intervalsRef.current[id]; }
//     setRunningTimers(prev => { const n={...prev}; delete n[id]; return n; });
//     setActiveTimers(prev => { const n={...prev}; delete n[id]; return n; });
//     saveTimers(customTimers.filter(t=>t.id!==id));
//   };
//   const startTimer = (id: string) => {
//     if (intervalsRef.current[id]) return;
//     setRunningTimers(prev => ({...prev,[id]:true}));
//     intervalsRef.current[id] = setInterval(() => {
//       setActiveTimers(prev => {
//         const cur = (prev[id]||0); if(cur<=1) { clearInterval(intervalsRef.current[id]); delete intervalsRef.current[id]; setRunningTimers(p=>({...p,[id]:false})); Vibration.vibrate([0,500,200,500]); return {...prev,[id]:0}; }
//         return {...prev,[id]:cur-1};
//       });
//     }, 1000);
//   };
//   const pauseTimer = (id: string) => { if(intervalsRef.current[id]) { clearInterval(intervalsRef.current[id]); delete intervalsRef.current[id]; } setRunningTimers(prev=>({...prev,[id]:false})); };
//   const resetTimer = (id: string) => { pauseTimer(id); const original = customTimers.find(t=>t.id===id); if(original) setActiveTimers(prev=>({...prev,[id]:original.seconds})); };
//   useEffect(() => { return () => { Object.values(intervalsRef.current).forEach(clearInterval); }; }, []);

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>TIMERS</Text><View style={{width:24}}/></View>
//       <ScrollView style={{padding:20}} showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom:30}}>

//         <Stopwatch />

//         {/* Countdown timer creator with linked numpad */}
//         <View style={{backgroundColor:COLORS.secondary,borderRadius:14,padding:16,marginBottom:20,borderWidth:1,borderColor:COLORS.accent}}>
//           <Text style={[styles.label,{marginBottom:12,textAlign:'center',letterSpacing:2}]}>CREATE COUNTDOWN TIMER</Text>
//           {/* HH:MM:SS linked display */}
//           <View style={{flexDirection:'row',justifyContent:'center',alignItems:'center',marginBottom:14}}>
//             <View style={styles.linkedSegment}><Text style={styles.linkedLabel}>HH</Text><Text style={styles.linkedValue}>{pad2(hours)}</Text></View>
//             <Text style={styles.linkedSep}>:</Text>
//             <View style={styles.linkedSegment}><Text style={styles.linkedLabel}>MM</Text><Text style={styles.linkedValue}>{pad2(minutes)}</Text></View>
//             <Text style={styles.linkedSep}>:</Text>
//             <View style={styles.linkedSegment}><Text style={styles.linkedLabel}>SS</Text><Text style={styles.linkedValue}>{pad2(seconds)}</Text></View>
//           </View>
//           {/* Numpad */}
//           <View style={{marginBottom:10}}>
//             {[['1','2','3'],['4','5','6'],['7','8','9'],['C','0','⌫']].map((row, ri) => (
//               <View key={ri} style={{flexDirection:'row',justifyContent:'center',marginBottom:6}}>
//                 {row.map(key => (
//                   <TouchableOpacity key={key} style={styles.numpadBtn} onPress={() => {
//                     if (key==='C') clearDigits();
//                     else if (key==='⌫') backspaceDigit();
//                     else pushDigit(key);
//                   }}>
//                     <Text style={[styles.numpadText, key==='C'&&{color:COLORS.danger}, key==='⌫'&&{color:COLORS.gold}]}>{key}</Text>
//                   </TouchableOpacity>
//                 ))}
//               </View>
//             ))}
//           </View>
//           <TextInput style={[styles.input,{marginBottom:8}]} placeholder="Label (optional)" placeholderTextColor={COLORS.textDark} value={newLabel} onChangeText={setNewLabel}/>
//           <TouchableOpacity style={[styles.mainButton,{marginTop:0,opacity:totalSeconds>0?1:0.4}]} onPress={addTimer} disabled={totalSeconds<=0}>
//             <Text style={styles.mainButtonText}>ADD TIMER</Text>
//           </TouchableOpacity>
//         </View>

//         {customTimers.length===0&&<Text style={{color:COLORS.textDark,textAlign:'center',marginTop:10,marginBottom:20}}>No countdown timers yet.</Text>}
//         {customTimers.map(timer => {
//           const remaining = activeTimers[timer.id]??timer.seconds;
//           const isRunning = runningTimers[timer.id]||false;
//           const progress = timer.seconds > 0 ? remaining/timer.seconds : 0;
//           const finished = remaining===0;
//           return (
//             <View key={timer.id} style={{backgroundColor:COLORS.secondary,borderRadius:12,padding:20,marginBottom:15,borderWidth:1,borderColor:finished?COLORS.gold:isRunning?COLORS.blue:COLORS.accent}}>
//               <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
//                 <Text style={{color:COLORS.text,fontWeight:'bold',fontSize:16}}>{timer.label}</Text>
//                 <TouchableOpacity onPress={() => deleteTimer(timer.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger}/></TouchableOpacity>
//               </View>
//               <View style={{height:4,backgroundColor:COLORS.accent,borderRadius:2,marginBottom:12}}><View style={{height:'100%',width:`${Math.max(0,progress*100)}%`,backgroundColor:finished?COLORS.gold:COLORS.blue,borderRadius:2}}/></View>
//               <Text style={{color:finished?COLORS.gold:COLORS.white,fontSize:44,fontWeight:'900',textAlign:'center',letterSpacing:2,marginBottom:8}}>{formatCountdown(remaining)}</Text>
//               {finished&&<Text style={{color:COLORS.gold,textAlign:'center',fontWeight:'bold',letterSpacing:2,marginBottom:8}}>⚡ TIME'S UP!</Text>}
//               <View style={{flexDirection:'row',justifyContent:'center'}}>
//                 <TouchableOpacity style={[styles.timerCtrlBtn,{backgroundColor:isRunning?COLORS.accent:COLORS.blue,marginRight:10}]} onPress={() => isRunning?pauseTimer(timer.id):startTimer(timer.id)}>
//                   <Ionicons name={isRunning?"pause":"play"} size={22} color={COLORS.white}/><Text style={styles.timerCtrlText}>{isRunning?'PAUSE':'START'}</Text>
//                 </TouchableOpacity>
//                 <TouchableOpacity style={[styles.timerCtrlBtn,{backgroundColor:COLORS.accent}]} onPress={() => resetTimer(timer.id)}>
//                   <Ionicons name="refresh" size={22} color={COLORS.text}/><Text style={styles.timerCtrlText}>RESET</Text>
//                 </TouchableOpacity>
//               </View>
//             </View>
//           );
//         })}
//       </ScrollView>
//     </View>
//   );
// }

// function MusicScreen({ playlist, currentTrack, isPlaying, isLoading, position, duration, playbackMode, onPlay, onPause, onSeek, onNext, onPrev, onDelete, onAdd, onToggleMode, onBack }: any) {
//   const [searchQuery, setSearchQuery] = useState('');
//   const getModeIcon = () => { switch(playbackMode) { case 'loop_one': return 'repeat-once'; case 'loop_all': return 'repeat'; case 'play_one': return 'numeric-1-box-outline'; case 'play_all': return 'playlist-play'; default: return 'repeat'; } };
//   const filteredPlaylist = playlist.filter((track: MusicTrack) => track.title.toLowerCase().includes(searchQuery.toLowerCase()));
//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>MUSIC PLAYER</Text><TouchableOpacity onPress={onToggleMode} style={styles.modeBtnHeader}><MaterialCommunityIcons name={getModeIcon()} size={20} color={COLORS.blue}/></TouchableOpacity></View>
//       <View style={styles.playerMain}>
//         {currentTrack&&currentTrack.artwork?(<Image source={{uri:currentTrack.artwork}} style={styles.albumArt}/>):(<View style={styles.albumArtPlaceholder}><Ionicons name="musical-note" size={80} color={COLORS.highlight}/></View>)}
//         <Text style={styles.nowPlayingTitle} numberOfLines={1}>{currentTrack?currentTrack.title:'Select a Track'}</Text>
//         <View style={styles.seekContainer}><Text style={styles.timeText}>{formatTime(position)}</Text><Slider style={{flex:1,marginHorizontal:10}} minimumValue={0} maximumValue={duration>0?duration:1} value={position} minimumTrackTintColor={COLORS.highlight} maximumTrackTintColor={COLORS.accent} thumbTintColor={COLORS.blue} onSlidingComplete={onSeek}/><Text style={styles.timeText}>{formatTime(duration)}</Text></View>
//         <View style={styles.playerControlsMain}>
//           <TouchableOpacity onPress={onPrev} style={styles.ctrlBtn}><Ionicons name="play-skip-back" size={30} color={COLORS.text}/></TouchableOpacity>
//           <TouchableOpacity onPress={onPause} style={styles.playButtonLarge}>{isLoading?(<View style={{width:30,height:30,borderWidth:3,borderRadius:15,borderColor:COLORS.primary,borderTopColor:COLORS.blue}}/>):(<Ionicons name={isPlaying?"pause":"play"} size={40} color={COLORS.primary}/>)}</TouchableOpacity>
//           <TouchableOpacity onPress={onNext} style={styles.ctrlBtn}><Ionicons name="play-skip-forward" size={30} color={COLORS.text}/></TouchableOpacity>
//         </View>
//       </View>
//       <View style={styles.playlistHeader}><Text style={styles.sectionTitle}>PLAYLIST</Text><TouchableOpacity onPress={onAdd} style={styles.addBtn}><Ionicons name="add" size={20} color={COLORS.primary}/></TouchableOpacity></View>
//       <View style={{paddingHorizontal:20,marginBottom:5}}><View style={styles.searchContainer}><Ionicons name="search" size={20} color={COLORS.textDark}/><TextInput style={styles.searchInput} placeholder="Search tracks..." placeholderTextColor={COLORS.textDark} value={searchQuery} onChangeText={setSearchQuery}/></View></View>
//       <ScrollView style={styles.playlistContainer} contentContainerStyle={{paddingBottom:20}} showsVerticalScrollIndicator={false}>
//         {filteredPlaylist.map((track: MusicTrack) => (
//           <View key={track.id} style={[styles.trackRow,currentTrack?.id===track.id&&styles.trackActive]}>
//             <TouchableOpacity style={styles.trackInfoArea} onPress={() => onPlay(track)}><View style={styles.trackIcon}><Ionicons name="musical-notes-outline" size={20} color={currentTrack?.id===track.id?COLORS.white:COLORS.textDark}/></View><Text style={[styles.trackName,currentTrack?.id===track.id&&styles.trackNameActive]} numberOfLines={1}>{track.title}</Text></TouchableOpacity>
//             <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(track.id)}><Ionicons name="trash-outline" size={18} color={COLORS.danger}/></TouchableOpacity>
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
//   // Stopwatch in ms for smooth display
//   const [workoutMs, setWorkoutMs] = useState(0);
//   const [activeExercise, setActiveExercise] = useState<string | null>(null);
//   const [manualInputs, setManualInputs] = useState<{[key:string]:string}>({});
//   const cameraRef = useRef<any>(null);
//   const appStateRef = useRef(AppState.currentState);
//   const startTimeRef = useRef<number>(Date.now());
//   const accumulatedMsRef = useRef(0);
//   const intervalRef = useRef<NodeJS.Timeout | null>(null);

//   useEffect(() => {
//     if (!permission) requestPermission();
//     const initCounts: any = {}; Object.keys(quest.exercises).forEach(k => initCounts[k]=0); setCounts(initCounts);
//   }, [permission]);

//   useEffect(() => {
//     const sub = AppState.addEventListener('change', nextState => {
//       if (appStateRef.current.match(/active/)&&nextState==='background') { accumulatedMsRef.current += Date.now()-startTimeRef.current; }
//       if (appStateRef.current==='background'&&nextState==='active') { startTimeRef.current = Date.now(); }
//       appStateRef.current = nextState;
//     });
//     return () => sub.remove();
//   }, []);

//   useEffect(() => {
//     startTimeRef.current = Date.now();
//     intervalRef.current = setInterval(() => { setWorkoutMs(accumulatedMsRef.current+(Date.now()-startTimeRef.current)); }, 33);
//     return () => { if(intervalRef.current) clearInterval(intervalRef.current); };
//   }, []);

//   const handleManualAdd = (ex: string, target: number) => { const amount=parseInt(manualInputs[ex]||'0'); if(amount>0) { const current=counts[ex]||0; const newVal=Math.min(current+amount,target); setCounts({...counts,[ex]:newVal}); setManualInputs({...manualInputs,[ex]:''}); } };
//   const handleDecrease = (ex: string) => { const current=counts[ex]||0; if(current>0) setCounts({...counts,[ex]:current-1}); };
//   const handleCheckAll = () => { showAlert("Complete All?","Mark all exercises as finished?",[{text:"Cancel",style:"cancel"},{text:"Yes",onPress:()=>setCounts(quest.exercises)}]); };
//   const isCompleted = (ex: string) => (counts[ex]||0)>=quest.exercises[ex];
//   const allCompleted = Object.keys(quest.exercises).every(isCompleted);
//   const isPoseSupported = (exKey: string) => PoseCalculator.isSupported(exKey);
//   const workoutSec = Math.floor(workoutMs/1000);

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}>
//         <TouchableOpacity onPress={onBack}><Ionicons name="close" size={24} color={COLORS.danger}/></TouchableOpacity>
//         <Text style={styles.headerTitle}>DUNGEON INSTANCE</Text>
//         <TouchableOpacity onPress={() => setCameraType(cameraType==='back'?'front':'back')}><Ionicons name="camera-reverse" size={24} color={COLORS.blue}/></TouchableOpacity>
//       </View>

//       {/* Stopwatch-style big training timer banner */}
//       <View style={styles.workoutTimerBanner}>
//         <Ionicons name="timer-outline" size={18} color={COLORS.gold}/>
//         <Text style={styles.workoutTimerText}>{formatStopwatch(workoutMs)}</Text>
//       </View>

//       {userData.cameraEnabled&&(
//         <View style={styles.cameraContainer}>
//           {permission?.granted?(
//             <CameraView style={styles.camera} facing={cameraType as any} ref={cameraRef}>
//               <View style={styles.cameraOverlay}>
//                 <Text style={styles.detectionText}>SYSTEM: POSE TRACKING ACTIVE</Text>
//                 {activeExercise&&!isPoseSupported(activeExercise)?(<View style={styles.camWarningBox}><Text style={styles.camWarningText}>CANNOT DETECT WITH CAM</Text></View>):(<View style={styles.poseBox}/>)}
//                 {activeExercise&&isPoseSupported(activeExercise)&&(<View style={styles.poseInfoBox}><Text style={styles.poseInfoText}>Detecting: {EXERCISES[activeExercise]?.name||activeExercise}</Text><Text style={styles.poseInfoSub}>Ensure full body visibility</Text></View>)}
//               </View>
//             </CameraView>
//           ):(
//             <View style={styles.cameraOff}><Ionicons name="videocam-off" size={40} color={COLORS.textDark}/><Text style={styles.cameraOffText}>CAMERA DISABLED</Text><Text style={styles.cameraOffSub}>Enable in Settings for Auto-Count</Text></View>
//           )}
//         </View>
//       )}

//       <ScrollView style={styles.exerciseList} contentContainerStyle={{paddingBottom:20}} showsVerticalScrollIndicator={false}>
//         {Object.entries(quest.exercises).map(([key, target]: [string, any]) => {
//           const def = quest.customExercises?.[key]||EXERCISES[key]||{name:key,iconName:'help',iconLib:'Ionicons'};
//           const count = counts[key]||0; const completed = isCompleted(key);
//           return (
//             <TouchableOpacity key={key} style={[styles.exerciseCard,completed&&styles.exerciseCardDone,activeExercise===key&&styles.exerciseCardActive]} onPress={() => setActiveExercise(key)}>
//               <View style={styles.exHeaderRow}>
//                 <View style={styles.exIcon}><SoloIcon name={def.iconName} lib={def.iconLib} size={28} color={COLORS.blue}/></View>
//                 <View style={{flex:1}}><Text style={styles.exName}>{def.name}</Text><View style={styles.progressBarBg}><View style={[styles.progressBarFill,{width:`${Math.min((count/target)*100,100)}%`}]}/></View></View>
//                 <Text style={styles.countTextLarge}>{count}/{target}</Text>
//               </View>
//               <View style={styles.seriesControls}>
//                 <TouchableOpacity style={styles.seriesBtnSmall} onPress={() => handleDecrease(key)} disabled={count===0}><Ionicons name="remove" size={16} color={COLORS.white}/></TouchableOpacity>
//                 <TextInput style={styles.seriesInput} placeholder="#" placeholderTextColor={COLORS.textDark} keyboardType="numeric" value={manualInputs[key]||''} onChangeText={(t) => setManualInputs({...manualInputs,[key]:t})}/>
//                 <TouchableOpacity style={styles.seriesBtn} onPress={() => handleManualAdd(key,target)} disabled={completed}><Text style={styles.seriesBtnText}>ADD SET</Text></TouchableOpacity>
//                 <TouchableOpacity style={[styles.checkBtn,completed?styles.checkBtnDone:{}]} onPress={() => setCounts({...counts,[key]:target})}><Ionicons name="checkmark" size={18} color={COLORS.white}/></TouchableOpacity>
//               </View>
//             </TouchableOpacity>
//           );
//         })}
//         <TouchableOpacity style={styles.checkAllBtn} onPress={handleCheckAll}><Text style={styles.checkAllText}>COMPLETE ALL EXERCISES</Text></TouchableOpacity>
//         {allCompleted&&(<TouchableOpacity style={styles.completeBtn} onPress={() => onComplete(counts,workoutSec)}><Text style={styles.completeBtnText}>COMPLETE DUNGEON</Text></TouchableOpacity>)}
//       </ScrollView>
//     </View>
//   );
// }

// function CustomProgramsScreen({ userData, customPrograms, setCustomPrograms, onBack, onStartProgram, showAlert }: any) {
//   const [modalVisible, setModalVisible] = useState(false);
//   const [newProgName, setNewProgName] = useState(''); const [editingId, setEditingId] = useState<string|null>(null);
//   const [selectedEx, setSelectedEx] = useState<{[key:string]:number}>({}); const [customList, setCustomList] = useState<Array<{id:string,name:string,reps:number}>>([]); const [customExName, setCustomExName] = useState(''); const [customExCount, setCustomExCount] = useState('10'); const [schedule, setSchedule] = useState<string[]>([]);
//   const toggleExercise = (key: string) => { const next={...selectedEx}; if(next[key]) delete next[key]; else next[key]=10; setSelectedEx(next); };
//   const updateReps = (key: string, val: string) => { setSelectedEx({...selectedEx,[key]:parseInt(val)||0}); };
//   const addCustomExercise = () => { if(!customExName) { showAlert("Error","Enter name"); return; } const newEx={id:`cust_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,name:customExName,reps:parseInt(customExCount)||10}; setCustomList([...customList,newEx]); setCustomExName(''); setCustomExCount('10'); };
//   const removeCustomExercise = (id: string) => { setCustomList(customList.filter(item=>item.id!==id)); };
//   const toggleDay = (day: string) => { if(schedule.includes(day)) setSchedule(schedule.filter(d=>d!==day)); else setSchedule([...schedule,day]); };
//   const openCreateModal = () => { setNewProgName(''); setEditingId(null); setSelectedEx({}); setCustomList([]); setSchedule([]); setModalVisible(true); };
//   const openEditModal = (prog: CustomProgram) => { setNewProgName(prog.name); setEditingId(prog.id); setSchedule(prog.schedule||[]); const stdEx: {[key:string]:number}={}; const cList: Array<{id:string,name:string,reps:number}>=[];  Object.entries(prog.exercises).forEach(([key,reps])=>{ if(EXERCISES[key]) stdEx[key]=reps; else if(prog.customExercises&&prog.customExercises[key]) cList.push({id:key,name:prog.customExercises[key].name,reps:reps}); }); setSelectedEx(stdEx); setCustomList(cList); setModalVisible(true); };
//   const saveProgram = () => { if(!newProgName) { showAlert("Error","Name required"); return; } let customDefs: ExerciseConfig={}; let finalExercises={...selectedEx}; customList.forEach(item=>{customDefs[item.id]={name:item.name,iconName:'star',iconLib:'Ionicons',custom:true,type:'reps'};finalExercises[item.id]=item.reps;}); const newProg: CustomProgram={id:editingId?editingId:Date.now().toString(),name:newProgName,exercises:finalExercises,customExercises:customDefs,schedule,createdAt:new Date().toISOString()}; let updated; if(editingId) updated=customPrograms.map((p:any)=>p.id===editingId?newProg:p); else updated=[...customPrograms,newProg]; setCustomPrograms(updated); setModalVisible(false); };
//   const deleteProgram = (id: string) => { setCustomPrograms(customPrograms.filter((p:any)=>p.id!==id)); };
//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>CUSTOM PROGRAMS</Text><TouchableOpacity onPress={openCreateModal}><Ionicons name="add-circle" size={30} color={COLORS.blue}/></TouchableOpacity></View>
//       <ScrollView style={{padding:20}} showsVerticalScrollIndicator={false}>
//         {customPrograms.map((p:any) => (
//           <View key={p.id} style={styles.programCard}>
//             <View style={{flex:1}}><Text style={styles.progTitle}>{p.name}</Text><Text style={styles.progSub}>{Object.keys(p.exercises).length} Exercises</Text>{p.schedule&&p.schedule.length>0&&<Text style={{color:COLORS.gold,fontSize:10}}>Scheduled: {p.schedule.join(', ')}</Text>}</View>
//             <TouchableOpacity style={styles.startBtnSmall} onPress={() => onStartProgram({title:p.name,difficulty:1,exercises:p.exercises,rewards:{xp:100,title:'Custom'},customExercises:p.customExercises,isDaily:false})}><Text style={styles.btnTextSmall}>START</Text></TouchableOpacity>
//             <TouchableOpacity style={styles.editProgBtn} onPress={() => openEditModal(p)}><Ionicons name="create-outline" size={20} color={COLORS.white}/></TouchableOpacity>
//             <TouchableOpacity style={styles.deleteProgBtn} onPress={() => deleteProgram(p.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger}/></TouchableOpacity>
//           </View>
//         ))}
//       </ScrollView>
//       <Modal visible={modalVisible} animationType="slide" transparent>
//         <View style={styles.modalOverlay}>
//           <View style={styles.createModal}>
//             <Text style={styles.modalTitle}>{editingId?'EDIT PROGRAM':'NEW PROGRAM'}</Text>
//             <TextInput style={styles.input} placeholder="Program Name" placeholderTextColor={COLORS.textDark} value={newProgName} onChangeText={setNewProgName}/>
//             <Text style={[styles.label,{marginTop:10}]}>Schedule as Daily Quest:</Text>
//             <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:10}}>{WEEK_DAYS.map(day=>(<TouchableOpacity key={day} onPress={()=>toggleDay(day)} style={[styles.dayBtn,schedule.includes(day)&&styles.dayBtnActive]}><Text style={[styles.dayBtnText,schedule.includes(day)&&{color:COLORS.white}]}>{day.charAt(0)}</Text></TouchableOpacity>))}</View>
//             <ScrollView style={{height:200,marginVertical:10}} showsVerticalScrollIndicator={false}>
//               {Object.entries(EXERCISES).map(([k,v])=>(<View key={k} style={styles.selectRowContainer}><Text style={styles.rowLabel}>{v.name}</Text><View style={{flexDirection:'row',alignItems:'center'}}>{selectedEx[k]?(<TextInput style={styles.repsInput} keyboardType="numeric" value={String(selectedEx[k])} onChangeText={(val)=>updateReps(k,val)}/>):null}<TouchableOpacity style={[styles.checkboxBtn,selectedEx[k]?styles.checkboxActive:{}]} onPress={()=>toggleExercise(k)}><Ionicons name={selectedEx[k]?"remove":"add"} size={20} color={selectedEx[k]?COLORS.white:COLORS.blue}/></TouchableOpacity></View></View>))}
//               {customList.length>0&&<Text style={[styles.label,{marginTop:15}]}>Added Custom:</Text>}
//               {customList.map(item=>(<View key={item.id} style={styles.selectRowContainer}><View style={{flex:1}}><Text style={styles.rowLabel}>{item.name} ({item.reps} reps)</Text></View><TouchableOpacity style={styles.deleteBtn} onPress={()=>removeCustomExercise(item.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger}/></TouchableOpacity></View>))}
//             </ScrollView>
//             <View style={{borderTopWidth:1,borderTopColor:COLORS.accent,paddingTop:10}}>
//               <Text style={styles.label}>Add Custom Exercise:</Text>
//               <View style={styles.row}>
//                 <TextInput style={[styles.input,{flex:2,marginRight:5}]} placeholder="Name" placeholderTextColor={COLORS.textDark} value={customExName} onChangeText={setCustomExName}/>
//                 <TextInput style={[styles.input,{flex:1,marginRight:5}]} keyboardType="numeric" placeholder="Reps" placeholderTextColor={COLORS.textDark} value={customExCount} onChangeText={setCustomExCount}/>
//                 <TouchableOpacity style={styles.addCustomBtn} onPress={addCustomExercise}><Ionicons name="add" size={24} color={COLORS.white}/></TouchableOpacity>
//               </View>
//             </View>
//             <View style={[styles.row,{marginTop:10}]}><TouchableOpacity style={styles.cancelBtn} onPress={()=>setModalVisible(false)}><Text style={styles.btnText}>CANCEL</Text></TouchableOpacity><TouchableOpacity style={styles.saveBtn} onPress={saveProgram}><Text style={styles.btnText}>SAVE</Text></TouchableOpacity></View>
//           </View>
//         </View>
//       </Modal>
//     </View>
//   );
// }

// function StatsScreen({ userData, onBack }: any) {
//   const [data, setData] = useState<number[]>([0]);
//   useEffect(() => { AsyncStorage.getItem('trainingHistory').then(h => { if(h) { const history=JSON.parse(h); const grouped: {[key:string]:number}={}; history.forEach((entry: TrainingHistory) => { const dateKey=entry.date.split('T')[0]; grouped[dateKey]=(grouped[dateKey]||0)+entry.xpGained; }); const sortedKeys=Object.keys(grouped).sort(); const xpData=sortedKeys.map(k=>grouped[k]); if(xpData.length>0) setData(xpData.slice(-6)); else setData([0]); } }); }, []);
//   return (
//     <ScrollView style={styles.screenContainer} showsVerticalScrollIndicator={false}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>STATISTICS</Text><View style={{width:24}}/></View>
//       <View style={{padding:20}}>
//         <Text style={styles.sectionTitle}>XP GAIN HISTORY</Text>
//         <LineChart data={{labels:["1","2","3","4","5","6"],datasets:[{data}]}} width={width-40} height={220} yAxisLabel="" yAxisSuffix=" XP" chartConfig={{backgroundColor:COLORS.secondary,backgroundGradientFrom:COLORS.secondary,backgroundGradientTo:COLORS.accent,decimalPlaces:0,color:(opacity=1)=>`rgba(59,130,246,${opacity})`,labelColor:(opacity=1)=>`rgba(255,255,255,${opacity})`,style:{borderRadius:16},propsForDots:{r:"6",strokeWidth:"2",stroke:COLORS.glow}}} style={{marginVertical:8,borderRadius:16}} bezier/>
//         <View style={styles.statBoxLarge}><Text style={styles.bigStat}>{userData.totalWorkouts}</Text><Text style={styles.bigStatLbl}>TOTAL DUNGEONS CLEARED</Text></View>
//       </View>
//     </ScrollView>
//   );
// }

// function QuestScreen({ userData, customPrograms, onBack, onStartTraining }: any) {
//   const getDailyQuest = (): Quest => {
//     const todayDay = getDayString(new Date()); const scheduledProg = customPrograms.find((p: CustomProgram) => p.schedule&&p.schedule.includes(todayDay));
//     if (scheduledProg) return { title:`DAILY: ${scheduledProg.name.toUpperCase()}`, difficulty:Math.floor(userData.level/5)+1, exercises:scheduledProg.exercises, customExercises:scheduledProg.customExercises, rewards:{xp:userData.level*100,title:'Hunter'}, isDaily:true };
//     const level=userData.level; let exercises: {[key:string]:number}={}; let title="DAILY QUEST"; let rewardXP=level*100;
//     if (userData.goal==='speed_strength') { title="ASSASSIN TRAINING"; exercises={clapPushups:Math.ceil(level*5),jumpSquats:Math.ceil(level*10),situps:Math.ceil(level*10),running:Math.min(1+(level*0.2),5)}; }
//     else if (userData.goal==='weight_loss') { title="ENDURANCE TRIAL"; exercises={squats:level*15,situps:level*15,burpees:level*5,running:Math.min(2+(level*0.5),10)}; }
//     else { title="STRENGTH TRAINING"; exercises={pushups:level*10,squats:level*10,situps:level*10,pullups:Math.ceil(level*2)}; }
//     return { title, difficulty:Math.floor(level/5)+1, exercises, rewards:{xp:rewardXP,title:'Hunter'}, isDaily:true };
//   };
//   const dailyQuest = getDailyQuest(); const [expanded, setExpanded] = useState(false);
//   const MAX_PREVIEW = 14; const exerciseEntries = Object.entries(dailyQuest.exercises); const hasMore = exerciseEntries.length>MAX_PREVIEW; const visibleExercises = expanded?exerciseEntries:exerciseEntries.slice(0,MAX_PREVIEW);
//   const isCompleted = userData.lastDailyQuestCompleted===getISODate(new Date());
//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>QUEST INFO</Text><View style={{width:24}}/></View>
//       <ScrollView style={{flex:1}} contentContainerStyle={{paddingBottom:10}} showsVerticalScrollIndicator={false}>
//         <View style={styles.questPaperDark}>
//           <Text style={styles.questTitleDark}>{dailyQuest.title}</Text>
//           <Text style={styles.difficulty}>Rank: {'★'.repeat(dailyQuest.difficulty)}</Text>
//           <View style={styles.divider}/>
//           <Text style={styles.objTitleDark}>OBJECTIVES:</Text>
//           {visibleExercises.map(([k,v]) => (<View key={k} style={[styles.objRow,{marginTop:5}]}><View style={{flexDirection:'row',alignItems:'center'}}><View style={{width:6,height:6,backgroundColor:COLORS.blue,marginRight:8}}/><Text style={styles.objTextDark}>{(dailyQuest.customExercises?.[k]?.name)||EXERCISES[k]?.name||k}</Text></View><Text style={styles.objValDark}>{String(v)}{EXERCISES[k]?.type==='distance'?' km':''}</Text></View>))}
//           {hasMore&&(<TouchableOpacity onPress={()=>setExpanded(!expanded)} style={styles.expandBtn}><Text style={styles.expandBtnText}>{expanded?'▲  SHOW LESS':`▼  +${exerciseEntries.length-MAX_PREVIEW} MORE OBJECTIVES`}</Text></TouchableOpacity>)}
//           <View style={styles.divider}/>
//           <Text style={styles.rewardTitleDark}>REWARDS:</Text>
//           <Text style={styles.rewardText}>+ {dailyQuest.rewards.xp} XP {isCompleted&&<Text style={{color:COLORS.gold}}>(REPEAT FOR BONUS XP)</Text>}</Text>
//         </View>
//       </ScrollView>
//       <View style={{paddingHorizontal:20,paddingTop:10,paddingBottom:10,borderTopWidth:1,borderTopColor:COLORS.accent,backgroundColor:COLORS.primary}}>
//         <TouchableOpacity style={[styles.acceptBtn,{marginBottom:0}]} onPress={() => onStartTraining(dailyQuest)}>
//           <Text style={styles.acceptBtnText}>{isCompleted?'REPEAT QUEST (+XP)':'ACCEPT QUEST'}</Text>
//         </TouchableOpacity>
//       </View>
//     </View>
//   );
// }

// function SettingsScreen({ userData, onSave, onBack }: any) {
//   const [camEnabled, setCamEnabled] = useState(userData.cameraEnabled); const [name, setName] = useState(userData.name); const [image, setImage] = useState(userData.profileImage);
//   const pickImage = async () => { let result = await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Images,allowsEditing:true,aspect:[1,1],quality:0.5}); if(!result.canceled) setImage(result.assets[0].uri); };
//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>SYSTEM SETTINGS</Text><View style={{width:24}}/></View>
//       <ScrollView style={{padding:20}} showsVerticalScrollIndicator={false}>
//         <View style={{alignItems:'center',marginBottom:20}}>
//           <TouchableOpacity onPress={pickImage}><Image source={image?{uri:image}:{uri:'https://via.placeholder.com/150'}} style={styles.settingsAvatar}/><View style={styles.editIconBadge}><Ionicons name="camera" size={14} color={COLORS.white}/></View></TouchableOpacity>
//           <Text style={[styles.label,{marginTop:10}]}>EDIT HUNTER NAME</Text><TextInput style={[styles.input,{textAlign:'center',width:'80%'}]} value={name} onChangeText={setName} placeholder="Hunter Name" placeholderTextColor={COLORS.textDark}/>
//         </View>
//         <View style={styles.divider}/>
//         <View style={styles.settingRow}><Text style={styles.settingText}>Enable Pose Detection (Camera)</Text><TouchableOpacity onPress={()=>setCamEnabled(!camEnabled)}><Ionicons name={camEnabled?"checkbox":"square-outline"} size={28} color={COLORS.blue}/></TouchableOpacity></View>
//         <TouchableOpacity style={styles.settingsSaveBtn} onPress={() => onSave({...userData,cameraEnabled:camEnabled,name,profileImage:image})}><Text style={styles.settingsSaveBtnText}>SAVE CHANGES</Text></TouchableOpacity>
//       </ScrollView>
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   expandBtn: { marginTop:10, alignItems:'center', paddingVertical:8, borderWidth:1, borderColor:COLORS.blue, borderRadius:6, borderStyle:'dashed' },
//   expandBtnText: { color:COLORS.blue, fontSize:11, fontWeight:'bold', letterSpacing:1.5 },
//   container: { flex:1, backgroundColor:COLORS.primary },
//   screenContainer: { flex:1, backgroundColor:COLORS.primary },
//   centerContainer: { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:COLORS.primary },
//   loadingTitle: { fontSize:32, fontWeight:'900', color:COLORS.blue, letterSpacing:4 },
//   loadingSubtitle: { color:COLORS.textDark, marginTop:10, letterSpacing:2 },
//   header: { flexDirection:'row', justifyContent:'space-between', padding:20, alignItems:'center', borderBottomWidth:1, borderBottomColor:COLORS.accent },
//   headerTitle: { color:COLORS.text, fontSize:18, fontWeight:'bold', letterSpacing:1.5 },
//   workoutTimerBanner: { flexDirection:'row', alignItems:'center', justifyContent:'center', paddingVertical:10, backgroundColor:COLORS.secondary, borderBottomWidth:1, borderBottomColor:COLORS.gold },
//   workoutTimerText: { color:COLORS.gold, fontSize:26, fontWeight:'900', letterSpacing:2, marginLeft:8 },
//   timerBadge: { flexDirection:'row', alignItems:'center', backgroundColor:COLORS.secondary, paddingVertical:4, paddingHorizontal:10, borderRadius:12, borderWidth:1, borderColor:COLORS.gold },
//   timerValue: { color:COLORS.gold, fontWeight:'bold', marginLeft:5, fontSize:12 },
//   avatarPicker: { alignSelf:'center', marginVertical:20 },
//   avatarPlaceholder: { width:100, height:100, borderRadius:50, backgroundColor:COLORS.accent, justifyContent:'center', alignItems:'center', borderStyle:'dashed', borderWidth:1, borderColor:COLORS.textDark },
//   avatarImage: { width:100, height:100, borderRadius:50 },
//   avatarText: { fontSize:10, color:COLORS.textDark, marginTop:5 },
//   formGroup: { marginBottom:15 },
//   row: { flexDirection:'row', justifyContent:'space-between' },
//   label: { color:COLORS.blue, fontSize:12, marginBottom:5, fontWeight:'bold' },
//   input: { backgroundColor:COLORS.secondary, color:COLORS.text, padding:15, borderRadius:8, borderWidth:1, borderColor:COLORS.accent },
//   genderContainer: { flexDirection:'row', justifyContent:'space-between' },
//   genderBtn: { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', padding:15, backgroundColor:COLORS.secondary, borderRadius:8, borderWidth:1, borderColor:COLORS.accent, marginHorizontal:5 },
//   genderBtnActive: { backgroundColor:COLORS.blue, borderColor:COLORS.glow },
//   genderText: { color:COLORS.blue, fontWeight:'bold', marginLeft:8 },
//   genderTextActive: { color:COLORS.white, fontWeight:'bold', marginLeft:8 },
//   goalBtn: { flexDirection:'row', alignItems:'center', padding:15, backgroundColor:COLORS.secondary, borderRadius:8, borderWidth:1, borderColor:COLORS.accent, marginBottom:8 },
//   goalBtnActive: { backgroundColor:COLORS.blue, borderColor:COLORS.glow },
//   goalText: { color:COLORS.blue, fontWeight:'bold', marginLeft:15 },
//   goalTextActive: { color:COLORS.white, fontWeight:'bold', marginLeft:15 },
//   mainButton: { backgroundColor:COLORS.blue, padding:18, borderRadius:8, alignItems:'center', marginTop:20 },
//   mainButtonText: { color:COLORS.primary, fontWeight:'bold', fontSize:16, letterSpacing:2 },
//   dashboardHeader: { padding:20, paddingTop:10 },
//   profileRow: { flexDirection:'row', alignItems:'center' },
//   profileImageSmall: { width:60, height:60, borderRadius:30, marginRight:15, borderWidth:2, borderColor:COLORS.blue },
//   playerName: { color:COLORS.text, fontSize:22, fontWeight:'bold' },
//   playerRank: { color:COLORS.glow, fontSize:12, letterSpacing:1 },
//   systemWindow: { margin:20, padding:20, backgroundColor:COLORS.secondary, borderRadius:12, borderWidth:1, borderColor:COLORS.blue },
//   systemHeader: { color:COLORS.text, textAlign:'center', fontWeight:'bold', marginBottom:15 },
//   xpBarContainer: { height:6, backgroundColor:COLORS.accent, borderRadius:3, marginBottom:5 },
//   xpBarFill: { height:'100%', backgroundColor:COLORS.blue, borderRadius:3 },
//   xpText: { color:COLORS.textDark, fontSize:10, textAlign:'right', marginBottom:15 },
//   statGrid: { flexDirection:'row', justifyContent:'space-around' },
//   statItem: { alignItems:'center' },
//   statVal: { color:COLORS.text, fontSize:18, fontWeight:'bold' },
//   statLbl: { color:COLORS.textDark, fontSize:10 },
//   menuGrid: { padding:20 },
//   menuCardLarge: { backgroundColor:COLORS.accent, padding:20, borderRadius:12, alignItems:'center', marginBottom:15, borderWidth:1, borderColor:COLORS.gold },
//   menuTitle: { color:COLORS.text, fontSize:18, fontWeight:'bold', marginTop:10 },
//   menuSub: { color:COLORS.danger, fontSize:12 },
//   menuRow: { flexDirection:'row', justifyContent:'space-between', marginBottom:15 },
//   menuCardSmall: { backgroundColor:COLORS.secondary, width:'48%', padding:15, borderRadius:12, alignItems:'center', borderWidth:1, borderColor:COLORS.accent },
//   menuTitleSmall: { color:COLORS.text, marginTop:5, fontSize:12 },
//   playerMain: { alignItems:'center', padding:20 },
//   albumArtPlaceholder: { width:140, height:140, backgroundColor:COLORS.secondary, borderRadius:12, justifyContent:'center', alignItems:'center', marginBottom:15, borderWidth:1, borderColor:COLORS.accent },
//   albumArt: { width:140, height:140, borderRadius:12, marginBottom:15, borderWidth:1, borderColor:COLORS.accent },
//   nowPlayingTitle: { color:COLORS.text, fontSize:18, fontWeight:'bold', marginBottom:10, textAlign:'center' },
//   seekContainer: { flexDirection:'row', alignItems:'center', width:'100%', marginBottom:15 },
//   timeText: { color:COLORS.textDark, fontSize:10, width:35, textAlign:'center' },
//   playerControlsMain: { flexDirection:'row', alignItems:'center', justifyContent:'space-around', width:'80%' },
//   playButtonLarge: { width:60, height:60, borderRadius:30, backgroundColor:COLORS.blue, justifyContent:'center', alignItems:'center' },
//   ctrlBtn: { padding:10 },
//   modeBtnHeader: { flexDirection:'row', alignItems:'center', backgroundColor:COLORS.secondary, padding:5, borderRadius:5, borderWidth:1, borderColor:COLORS.accent },
//   playlistHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:20, marginTop:10 },
//   sectionTitle: { color:COLORS.blue, fontWeight:'bold' },
//   addBtn: { backgroundColor:COLORS.highlight, padding:5, borderRadius:4 },
//   searchContainer: { flexDirection:'row', alignItems:'center', backgroundColor:COLORS.secondary, borderRadius:8, paddingHorizontal:10, paddingVertical:5, borderWidth:1, borderColor:COLORS.accent, marginTop:10 },
//   searchInput: { flex:1, color:COLORS.text, marginLeft:10, paddingVertical:5 },
//   playlistContainer: { padding:20 },
//   trackRow: { flexDirection:'row', alignItems:'center', paddingVertical:12, borderBottomWidth:1, borderBottomColor:COLORS.accent, justifyContent:'space-between' },
//   trackActive: { backgroundColor:COLORS.accent },
//   trackInfoArea: { flexDirection:'row', alignItems:'center', flex:1 },
//   trackIcon: { width:30 },
//   trackName: { color:COLORS.textDark, flex:1, fontSize:14, marginLeft:5 },
//   trackNameActive: { color:COLORS.white, fontWeight:'bold', textShadowColor:COLORS.glow, textShadowRadius:8 },
//   deleteBtn: { padding:5 },
//   miniPlayerContainer: { position:'relative', bottom:0, left:0, right:0, height:70, backgroundColor:COLORS.secondary, borderTopWidth:1, borderTopColor:COLORS.blue, zIndex:999 },
//   miniProgressContainer: { height:2, backgroundColor:COLORS.accent, width:'100%' },
//   miniProgressFill: { height:'100%', backgroundColor:COLORS.highlight },
//   miniPlayerContent: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:15, flex:1 },
//   miniInfo: { flexDirection:'row', alignItems:'center', flex:1, paddingRight:10 },
//   miniArt: { width:40, height:40, borderRadius:4, marginRight:10 },
//   miniTitle: { color:COLORS.white, fontWeight:'bold', fontSize:14 },
//   miniTime: { color:COLORS.textDark, fontSize:10 },
//   miniControls: { flexDirection:'row', alignItems:'center' },
//   miniCtrlBtn: { marginHorizontal:8 },
//   cameraContainer: { height:250, backgroundColor:'#000', overflow:'hidden' },
//   camera: { flex:1 },
//   cameraOverlay: { flex:1, justifyContent:'center', alignItems:'center' },
//   detectionText: { color:COLORS.success, fontSize:10, position:'absolute', top:10, right:10, backgroundColor:'rgba(0,0,0,0.5)', padding:4 },
//   poseBox: { width:200, height:300, borderWidth:2, borderColor:COLORS.glow, opacity:0.5 },
//   camWarningBox: { backgroundColor:'rgba(239,68,68,0.8)', padding:10, borderRadius:5 },
//   camWarningText: { color:COLORS.white, fontWeight:'bold' },
//   poseInfoBox: { position:'absolute', bottom:10, left:10, right:10, backgroundColor:'rgba(0,0,0,0.6)', padding:10, borderRadius:5 },
//   poseInfoText: { color:COLORS.success, fontWeight:'bold', fontSize:12 },
//   poseInfoSub: { color:COLORS.textDark, fontSize:10 },
//   cameraOff: { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:COLORS.secondary },
//   cameraOffText: { color:COLORS.text, fontWeight:'bold', marginTop:10 },
//   cameraOffSub: { color:COLORS.textDark, fontSize:10 },
//   exerciseList: { flex:1, padding:20 },
//   exerciseCard: { backgroundColor:COLORS.secondary, padding:15, marginBottom:10, borderRadius:8, borderWidth:1, borderColor:COLORS.accent },
//   exerciseCardActive: { borderColor:COLORS.blue, backgroundColor:'#1e293b' },
//   exerciseCardDone: { opacity:0.6, borderColor:COLORS.success },
//   exHeaderRow: { flexDirection:'row', alignItems:'center', marginBottom:10 },
//   exIcon: { width:40 },
//   exName: { color:COLORS.text, fontWeight:'bold', marginBottom:5 },
//   progressBarBg: { height:4, backgroundColor:COLORS.accent, borderRadius:2, width:'90%' },
//   progressBarFill: { height:'100%', backgroundColor:COLORS.blue, borderRadius:2 },
//   countTextLarge: { color:COLORS.white, fontSize:16, fontWeight:'bold' },
//   seriesControls: { flexDirection:'row', alignItems:'center', marginTop:5, justifyContent:'flex-end' },
//   seriesInput: { width:50, height:35, backgroundColor:COLORS.primary, color:COLORS.white, textAlign:'center', borderRadius:4, borderWidth:1, borderColor:COLORS.accent, marginHorizontal:5 },
//   seriesBtn: { backgroundColor:COLORS.blue, paddingHorizontal:10, paddingVertical:8, borderRadius:4, marginHorizontal:5 },
//   seriesBtnSmall: { backgroundColor:COLORS.accent, width:35, height:35, borderRadius:4, alignItems:'center', justifyContent:'center' },
//   seriesBtnText: { color:COLORS.white, fontSize:10, fontWeight:'bold' },
//   checkBtn: { width:35, height:35, borderRadius:17.5, borderWidth:1, borderColor:COLORS.textDark, alignItems:'center', justifyContent:'center', marginLeft:10 },
//   checkBtnDone: { backgroundColor:COLORS.success, borderColor:COLORS.success },
//   checkAllBtn: { marginVertical:10, padding:10, borderWidth:1, borderColor:COLORS.blue, borderRadius:8, alignItems:'center' },
//   checkAllText: { color:COLORS.blue, fontSize:12, fontWeight:'bold', letterSpacing:1 },
//   completeBtn: { backgroundColor:COLORS.blue, margin:20, padding:15, borderRadius:8, alignItems:'center' },
//   completeBtnText: { color:COLORS.primary, fontWeight:'bold', letterSpacing:2 },
//   programCard: { backgroundColor:COLORS.secondary, padding:15, borderRadius:8, marginBottom:15, flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
//   progTitle: { color:COLORS.text, fontSize:16, fontWeight:'bold' },
//   progSub: { color:COLORS.textDark, fontSize:12 },
//   startBtnSmall: { backgroundColor:COLORS.success, paddingHorizontal:12, paddingVertical:6, borderRadius:4, marginRight:10 },
//   editProgBtn: { backgroundColor:COLORS.accent, paddingHorizontal:8, paddingVertical:6, borderRadius:4, marginRight:10 },
//   deleteProgBtn: { padding:5 },
//   btnTextSmall: { color:COLORS.primary, fontWeight:'bold', fontSize:10 },
//   modalOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.8)', justifyContent:'center', padding:20 },
//   createModal: { backgroundColor:COLORS.secondary, padding:20, borderRadius:12, borderWidth:1, borderColor:COLORS.blue },
//   modalTitle: { color:COLORS.text, fontSize:18, fontWeight:'bold', textAlign:'center', marginBottom:15 },
//   selectRowContainer: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:10, borderBottomWidth:1, borderBottomColor:COLORS.accent },
//   rowLabel: { color:COLORS.textDark, fontSize:16 },
//   repsInput: { backgroundColor:COLORS.primary, color:COLORS.white, width:50, padding:5, borderRadius:4, textAlign:'center', borderWidth:1, borderColor:COLORS.blue, marginRight:10 },
//   checkboxBtn: { padding:5, borderRadius:4, borderWidth:1, borderColor:COLORS.blue },
//   checkboxActive: { backgroundColor:COLORS.danger, borderColor:COLORS.danger },
//   addCustomBtn: { backgroundColor:COLORS.blue, padding:10, borderRadius:4, justifyContent:'center', alignItems:'center' },
//   cancelBtn: { flex:1, padding:15, alignItems:'center', marginRight:10 },
//   saveBtn: { flex:1, backgroundColor:COLORS.blue, padding:15, alignItems:'center', borderRadius:6 },
//   btnText: { color:COLORS.text, fontWeight:'bold' },
//   settingsSaveBtn: { backgroundColor:COLORS.blue, padding:18, borderRadius:8, alignItems:'center', marginTop:30 },
//   settingsSaveBtnText: { color:COLORS.white, fontWeight:'bold', fontSize:16, letterSpacing:1 },
//   settingsAvatar: { width:120, height:120, borderRadius:60, borderWidth:2, borderColor:COLORS.blue, marginBottom:10 },
//   editIconBadge: { position:'absolute', bottom:10, right:10, backgroundColor:COLORS.blue, width:30, height:30, borderRadius:15, justifyContent:'center', alignItems:'center', borderWidth:2, borderColor:COLORS.secondary },
//   statBoxLarge: { backgroundColor:COLORS.accent, padding:20, alignItems:'center', borderRadius:12, marginTop:20 },
//   bigStat: { color:COLORS.blue, fontSize:40, fontWeight:'bold' },
//   bigStatLbl: { color:COLORS.textDark, fontSize:12, letterSpacing:2 },
//   questPaperDark: { backgroundColor:COLORS.secondary, margin:20, padding:20, borderRadius:8, borderWidth:1, borderColor:COLORS.accent },
//   questTitleDark: { color:COLORS.text, fontSize:20, fontWeight:'bold', textAlign:'center' },
//   difficulty: { color:COLORS.gold, textAlign:'center', fontSize:12, marginBottom:10 },
//   objTitleDark: { color:COLORS.blue, fontWeight:'bold', marginTop:10 },
//   objRow: { flexDirection:'row', justifyContent:'space-between', marginTop:5 },
//   objTextDark: { color:COLORS.text },
//   objValDark: { color:COLORS.text, fontWeight:'bold' },
//   divider: { height:1, backgroundColor:COLORS.accent, marginVertical:10 },
//   rewardTitleDark: { color:COLORS.text, fontWeight:'bold' },
//   rewardText: { color:COLORS.blue, fontWeight:'bold' },
//   acceptBtn: { backgroundColor:COLORS.blue, margin:20, padding:15, borderRadius:8, alignItems:'center' },
//   acceptBtnText: { color:COLORS.primary, fontWeight:'bold', letterSpacing:2 },
//   settingRow: { flexDirection:'row', justifyContent:'space-between', paddingVertical:15, borderBottomWidth:1, borderBottomColor:COLORS.accent, alignItems:'center' },
//   settingText: { color:COLORS.text, fontSize:16 },
//   alertBox: { backgroundColor:COLORS.secondary, borderRadius:12, borderWidth:2, borderColor:COLORS.blue, padding:20, width:'100%' },
//   alertTitle: { color:COLORS.blue, fontSize:18, fontWeight:'bold', textAlign:'center', letterSpacing:1 },
//   alertMessage: { color:COLORS.text, textAlign:'center', marginVertical:15 },
//   alertButtons: { flexDirection:'row', justifyContent:'center', marginTop:10 },
//   alertButton: { paddingHorizontal:20, paddingVertical:10, borderRadius:6, minWidth:80, alignItems:'center', marginHorizontal:5 },
//   alertButtonDefault: { backgroundColor:COLORS.blue },
//   alertButtonDestructive: { backgroundColor:COLORS.danger },
//   alertButtonCancel: { backgroundColor:COLORS.accent },
//   alertButtonText: { color:COLORS.text, fontWeight:'bold', fontSize:12 },
//   timerCircle: { width:120, height:120, borderRadius:60, borderWidth:4, borderColor:COLORS.blue, justifyContent:'center', alignItems:'center', marginVertical:30 },
//   timerText: { fontSize:40, fontWeight:'bold', color:COLORS.white },
//   dayBtn: { width:35, height:35, borderRadius:17.5, backgroundColor:COLORS.secondary, justifyContent:'center', alignItems:'center', borderWidth:1, borderColor:COLORS.accent },
//   dayBtnActive: { backgroundColor:COLORS.blue, borderColor:COLORS.glow },
//   dayBtnText: { color:COLORS.textDark, fontSize:12, fontWeight:'bold' },
//   timerCtrlBtn: { flexDirection:'row', alignItems:'center', paddingHorizontal:20, paddingVertical:10, borderRadius:8, marginHorizontal:5 },
//   timerCtrlText: { color:COLORS.white, fontWeight:'bold', marginLeft:6, fontSize:13, letterSpacing:1 },
//   // Linked input display styles
//   linkedSegment: { alignItems:'center', backgroundColor:COLORS.accent, borderRadius:8, paddingVertical:8, paddingHorizontal:14, marginHorizontal:2 },
//   linkedLabel: { color:COLORS.textDark, fontSize:9, fontWeight:'bold', letterSpacing:1, marginBottom:2 },
//   linkedValue: { color:COLORS.white, fontSize:28, fontWeight:'900' },
//   linkedSep: { color:COLORS.blue, fontSize:28, fontWeight:'900', marginHorizontal:2, marginTop:8 },
//   // Numpad styles
//   numpadBtn: { width:72, height:50, backgroundColor:COLORS.accent, borderRadius:8, justifyContent:'center', alignItems:'center', marginHorizontal:5, borderWidth:1, borderColor:COLORS.secondary },
//   numpadText: { color:COLORS.white, fontSize:22, fontWeight:'bold' },
// });





// import { FontAwesome5, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
// import AsyncStorage from "@react-native-async-storage/async-storage";
// import Slider from "@react-native-community/slider";
// import { Audio } from "expo-av";
// import { CameraView, useCameraPermissions } from "expo-camera";
// import * as DocumentPicker from "expo-document-picker";
// import * as ImagePicker from "expo-image-picker";
// import React, { useEffect, useRef, useState } from "react";
// import { Animated, AppState, BackHandler, Dimensions, Image, Modal, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, Vibration, View } from "react-native";
// import { LineChart } from "react-native-chart-kit";
// import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

// const { width } = Dimensions.get('window');

// type GoalType = 'muscle' | 'weight_loss' | 'speed_strength';
// interface UserData { name: string; level: number; sex: 'male' | 'female'; weight: number; height: number; goal: GoalType; xp: number; totalWorkouts: number; createdAt: string; lastDailyQuestCompleted?: string; cameraEnabled: boolean; profileImage?: string; assessmentStats?: { [key: string]: number }; }
// interface Exercise { name: string; iconName: string; iconLib: 'Ionicons' | 'MaterialCommunityIcons' | 'FontAwesome5'; type?: 'reps' | 'duration' | 'distance'; custom?: boolean; }
// interface ExerciseConfig { [key: string]: Exercise; }
// interface Quest { title: string; difficulty: number; exercises: { [key: string]: number }; rewards: { xp: number; title: string }; customExercises?: ExerciseConfig; isDaily?: boolean; }
// interface TrainingResult { [key: string]: number; }
// interface TrainingHistory { date: string; quest: Quest; results: TrainingResult; xpGained: number; durationSeconds?: number; }
// interface MusicTrack { id: string; title: string; path: any; isLocal: boolean; isFavorite: boolean; artwork?: string; }
// interface CustomProgram { id: string; name: string; exercises: { [key: string]: number }; customExercises?: ExerciseConfig; schedule: string[]; createdAt: string; }
// interface AlertButton { text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive'; }
// interface CustomAlertState { visible: boolean; title: string; message: string; buttons: AlertButton[]; }
// interface CustomTimer { id: string; label: string; seconds: number; }
// type PlaybackMode = 'loop_all' | 'play_all' | 'loop_one' | 'play_one';

// const COLORS = { primary: '#050714', secondary: '#0F172A', accent: '#1E293B', highlight: '#2563EB', blue: '#3B82F6', lightBlue: '#60A5FA', purple: '#7C3AED', danger: '#EF4444', success: '#10B981', text: '#F8FAFC', textDark: '#94A3B8', glow: '#0EA5E9', gold: '#F59E0B', white: '#FFFFFF' };
// const XP_PER_LEVEL_BASE = 600;
// const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// const EXERCISES: ExerciseConfig = {
//   squats: { name: 'Squats', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   pushups: { name: 'Push-ups', iconName: 'human-handsup', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   situps: { name: 'Sit-ups', iconName: 'dumbbell', iconLib: 'FontAwesome5', type: 'reps' },
//   pullups: { name: 'Pull-ups', iconName: 'human-male-height', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   bicepCurls: { name: 'Bicep Curls', iconName: 'arm-flex', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   lunges: { name: 'Lunges', iconName: 'run', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   plank: { name: 'Plank (sec)', iconName: 'timer', iconLib: 'Ionicons', type: 'duration' },
//   running: { name: 'Running (km)', iconName: 'run-fast', iconLib: 'MaterialCommunityIcons', type: 'distance' },
//   clapPushups: { name: 'Clap Push-ups', iconName: 'flash', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   jumpSquats: { name: 'Jump Squats', iconName: 'arrow-up-bold-circle', iconLib: 'MaterialCommunityIcons', type: 'reps' },
//   burpees: { name: 'Burpees', iconName: 'human-handsdown', iconLib: 'MaterialCommunityIcons', type: 'reps' },
// };

// class PoseCalculator {
//   static calculateAngle(a: {x:number,y:number}, b: {x:number,y:number}, c: {x:number,y:number}) { const radians = Math.atan2(c.y-b.y,c.x-b.x)-Math.atan2(a.y-b.y,a.x-b.x); let angle = Math.abs(radians*180.0/Math.PI); if(angle>180.0) angle=360-angle; return angle; }
//   static detectSquat(landmarks: any): { angle: number } { return { angle: 0 }; }
//   static isSupported(exerciseKey: string): boolean { return ['squats','pushups','situps','bicepCurls','lifting'].includes(exerciseKey); }
// }

// const SYSTEM_SOUND = require('../assets/audio/solo_leveling_system.mp3');
// const DEFAULT_OST = require('../assets/audio/ost.mp3');
// const getDayString = (date: Date) => date.toLocaleDateString('en-US', { weekday: 'short' });
// const getISODate = (date: Date) => date.toISOString().split('T')[0];
// const formatTime = (seconds: number) => { const m = Math.floor(seconds/60); const s = Math.floor(seconds%60); return `${m}:${s<10?'0':''}${s}`; };

// const SoloIcon = ({ name, lib, size = 24, color = COLORS.text }: { name: string, lib: string, size?: number, color?: string }) => {
//   if (lib==='Ionicons') return <Ionicons name={name as any} size={size} color={color} />;
//   if (lib==='MaterialCommunityIcons') return <MaterialCommunityIcons name={name as any} size={size} color={color} />;
//   if (lib==='FontAwesome5') return <FontAwesome5 name={name as any} size={size} color={color} />;
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
//               <TouchableOpacity key={index} style={[styles.alertButton, btn.style==='destructive'?styles.alertButtonDestructive:btn.style==='cancel'?styles.alertButtonCancel:styles.alertButtonDefault]} onPress={() => { if(btn.onPress) btn.onPress(); onClose(); }}>
//                 <Text style={styles.alertButtonText}>{btn.text}</Text>
//               </TouchableOpacity>
//             ))}
//           </View>
//         </View>
//       </View>
//     </Modal>
//   );
// };

// export default function SoloLevelingFitnessTracker(): JSX.Element {
//   const [screen, setScreenState] = useState<string>('loading');
//   const [userData, setUserData] = useState<UserData | null>(null);
//   const [customPrograms, setCustomPrograms] = useState<CustomProgram[]>([]);
//   const [alertState, setAlertState] = useState<CustomAlertState>({ visible: false, title: '', message: '', buttons: [] });
//   const [playlist, setPlaylist] = useState<MusicTrack[]>([]);
//   const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
//   const [sound, setSound] = useState<Audio.Sound | null>(null);
//   const [isPlaying, setIsPlaying] = useState(false);
//   const [musicLoading, setMusicLoading] = useState(false);
//   const [position, setPosition] = useState(0);
//   const [duration, setDuration] = useState(0);
//   const [isMuted, setIsMuted] = useState(false);
//   const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('loop_all');
//   const playlistRef = useRef<MusicTrack[]>([]); const currentTrackRef = useRef<MusicTrack | null>(null); const playbackModeRef = useRef<PlaybackMode>('loop_all');
//   useEffect(() => { playlistRef.current = playlist; }, [playlist]);
//   useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
//   useEffect(() => { playbackModeRef.current = playbackMode; }, [playbackMode]);
//   const [systemSoundObj, setSystemSoundObj] = useState<Audio.Sound | null>(null);
//   const [currentQuest, setCurrentQuest] = useState<Quest | null>(null);
//   const [isTraining, setIsTraining] = useState<boolean>(false);

//   const playSystemSound = async () => {
//     try {
//       if (systemSoundObj) await systemSoundObj.unloadAsync();
//       if (sound && isPlaying) await sound.setVolumeAsync(0.1);
//       const { sound: newSysSound } = await Audio.Sound.createAsync(SYSTEM_SOUND);
//       setSystemSoundObj(newSysSound);
//       await newSysSound.playAsync();
//       newSysSound.setOnPlaybackStatusUpdate(async (status) => { if(status.isLoaded&&status.didJustFinish) { await newSysSound.unloadAsync(); setSystemSoundObj(null); if(sound&&isPlaying) await sound.setVolumeAsync(1.0); } });
//     } catch (error) { console.log('System sound error', error); }
//   };

//   const navigateTo = (newScreen: string) => { if(newScreen!==screen) { playSystemSound(); setScreenState(newScreen); } };
//   const showAlert = (title: string, message: string, buttons: AlertButton[] = [{ text: 'OK' }]) => { setAlertState({ visible: true, title, message, buttons }); };
//   const closeAlert = () => { setAlertState(prev => ({ ...prev, visible: false })); };

//   useEffect(() => {
//     const backAction = () => {
//       if (systemSoundObj) { try { systemSoundObj.stopAsync(); systemSoundObj.unloadAsync(); setSystemSoundObj(null); } catch(e) {} }
//       if (screen==='dashboard'||screen==='loading'||screen==='setup') return false;
//       if (screen==='training') { showAlert("Abort Mission?","Stop training?",[{text:"Cancel",style:"cancel"},{text:"Quit",style:"destructive",onPress:()=>navigateTo('dashboard')}]); return true; }
//       navigateTo('dashboard'); return true;
//     };
//     const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
//     return () => backHandler.remove();
//   }, [screen, systemSoundObj]);

//   useEffect(() => {
//     async function init() {
//       try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false, staysActiveInBackground: true, playsInSilentModeIOS: true, shouldDuckAndroid: true, playThroughEarpieceAndroid: false }); } catch(e) { console.warn("Audio Mode Config Error:",e); }
//       try {
//         const stored = await AsyncStorage.getItem('musicPlaylist');
//         const defaultTrack: MusicTrack = { id: 'default_ost', title: 'System Soundtrack (Default)', path: DEFAULT_OST, isLocal: true, isFavorite: true };
//         let tracks: MusicTrack[] = [defaultTrack];
//         if (stored) { const parsed = JSON.parse(stored); tracks = [...tracks, ...parsed.filter((t: MusicTrack) => t.id!=='default_ost')]; }
//         setPlaylist(tracks);
//       } catch(e) { console.error("Audio Init Error",e); }
//       playSystemSound();
//       const progData = await AsyncStorage.getItem('customPrograms');
//       const loadedPrograms: CustomProgram[] = progData ? JSON.parse(progData) : [];
//       setCustomPrograms(loadedPrograms);
//       const data = await AsyncStorage.getItem('userData');
//       if (data) { let user: UserData = JSON.parse(data); user = await checkPenalties(user, loadedPrograms); setUserData(user); setScreenState('dashboard'); } else { setScreenState('setup'); }
//     }
//     init();
//     return () => { if(sound) sound.unloadAsync(); if(systemSoundObj) systemSoundObj.unloadAsync(); };
//   }, []);

//   const checkPenalties = async (user: UserData, programs: CustomProgram[]): Promise<UserData> => {
//     if (!user.lastDailyQuestCompleted) { const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1); user.lastDailyQuestCompleted = getISODate(yesterday); await AsyncStorage.setItem('userData', JSON.stringify(user)); return user; }
//     const lastDate = new Date(user.lastDailyQuestCompleted); const today = new Date(); const todayStr = getISODate(today);
//     if (user.lastDailyQuestCompleted===todayStr) return user;
//     let penaltyXP = 0; let missedDays = 0;
//     const checkDate = new Date(lastDate); checkDate.setDate(checkDate.getDate()+1);
//     const historyData = await AsyncStorage.getItem('trainingHistory'); const history: TrainingHistory[] = historyData ? JSON.parse(historyData) : []; let historyChanged = false;
//     while (getISODate(checkDate)<todayStr) {
//       const dailyPenaltyAmount = user.level*100; penaltyXP += dailyPenaltyAmount; missedDays++;
//       history.push({ date: checkDate.toISOString(), quest: { title:"PENALTY: MISSED QUEST", difficulty:0, exercises:{}, rewards:{xp:0,title:'None'} }, results:{}, xpGained:-dailyPenaltyAmount, durationSeconds:0 });
//       historyChanged = true; checkDate.setDate(checkDate.getDate()+1);
//     }
//     if (penaltyXP>0) {
//       let newXP = user.xp-penaltyXP; let newLevel = user.level;
//       while (newXP<0) { if(newLevel>1) { newLevel--; newXP = newLevel*XP_PER_LEVEL_BASE+newXP; } else { newXP=0; break; } }
//       user.xp = newXP; user.level = newLevel;
//       const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1); user.lastDailyQuestCompleted = getISODate(yesterday);
//       showAlert("PENALTY SYSTEM",`You failed to complete daily quests for ${missedDays} day(s).\n\nPUNISHMENT: -${penaltyXP} XP.`);
//       await AsyncStorage.setItem('userData', JSON.stringify(user));
//       if (historyChanged) await AsyncStorage.setItem('trainingHistory', JSON.stringify(history));
//     }
//     return user;
//   };

//   useEffect(() => {
//     let interval: NodeJS.Timeout;
//     if (sound&&isPlaying) { interval = setInterval(async () => { try { const status = await sound.getStatusAsync(); if(status.isLoaded) { setPosition(status.positionMillis/1000); setDuration(status.durationMillis?status.durationMillis/1000:1); } } catch(e) {} }, 1000); }
//     return () => clearInterval(interval);
//   }, [sound, isPlaying]);

//   const handleAutoNext = async (currentSound: Audio.Sound) => {
//     const list = playlistRef.current; const curr = currentTrackRef.current; const mode = playbackModeRef.current;
//     if (!curr||list.length===0) return;
//     if (mode==='loop_one') await currentSound.replayAsync();
//     else if (mode==='play_one') { setIsPlaying(false); setPosition(0); await currentSound.stopAsync(); await currentSound.setPositionAsync(0); }
//     else if (mode==='play_all') { const idx=list.findIndex(t=>t.id===curr.id); if(idx!==-1&&idx<list.length-1) playTrack(list[idx+1]); else { setIsPlaying(false); setPosition(0); await currentSound.stopAsync(); await currentSound.setPositionAsync(0); } }
//     else if (mode==='loop_all') { const idx=list.findIndex(t=>t.id===curr.id); playTrack(list[(idx+1)%list.length]); }
//   };

//   const saveUserData = async (data: UserData) => { await AsyncStorage.setItem('userData', JSON.stringify(data)); setUserData(data); };
//   const updateCustomPrograms = async (programs: CustomProgram[]) => { setCustomPrograms(programs); await AsyncStorage.setItem('customPrograms', JSON.stringify(programs)); };

//   const playTrack = async (track: MusicTrack) => {
//     if (musicLoading) return;
//     if (currentTrack?.id===track.id&&sound) { const status = await sound.getStatusAsync(); if(status.isLoaded&&!status.isPlaying) { await sound.playAsync(); setIsPlaying(true); return; } }
//     try {
//       setMusicLoading(true);
//       if (sound) { await sound.unloadAsync(); setSound(null); }
//       const source = track.isLocal ? track.path : { uri: track.path };
//       const shouldLoop = playbackModeRef.current==='loop_one';
//       const { sound: newSound } = await Audio.Sound.createAsync(source, { shouldPlay: true, isLooping: shouldLoop });
//       newSound.setOnPlaybackStatusUpdate((status) => { if(status.isLoaded&&status.didJustFinish&&!status.isLooping) handleAutoNext(newSound); });
//       if (isMuted) await newSound.setIsMutedAsync(true);
//       setSound(newSound); setCurrentTrack(track); setIsPlaying(true); setMusicLoading(false);
//     } catch (error) { console.log('Play Error',error); setMusicLoading(false); showAlert('Error','Could not play audio track.'); }
//   };

//   const togglePlayPause = async () => { if(!sound) { if(playlist.length>0) playTrack(playlist[0]); return; } if(musicLoading) return; if(isPlaying) { await sound.pauseAsync(); setIsPlaying(false); } else { await sound.playAsync(); setIsPlaying(true); } };
//   const seekTrack = async (value: number) => { if(sound&&!musicLoading) { await sound.setPositionAsync(value*1000); setPosition(value); } };
//   const skipToNext = () => { if(!currentTrack||playlist.length===0) return; const idx=playlist.findIndex(t=>t.id===currentTrack.id); playTrack(playlist[(idx+1)%playlist.length]); };
//   const skipToPrev = () => { if(!currentTrack||playlist.length===0) return; const idx=playlist.findIndex(t=>t.id===currentTrack.id); playTrack(playlist[idx===0?playlist.length-1:idx-1]); };
//   const deleteTrack = async (trackId: string) => { if(trackId==='default_ost') return; if(currentTrack?.id===trackId) { if(sound) await sound.unloadAsync(); setSound(null); setCurrentTrack(null); setIsPlaying(false); } const newList=playlist.filter(t=>t.id!==trackId); setPlaylist(newList); AsyncStorage.setItem('musicPlaylist',JSON.stringify(newList)); };
//   const addMusicFile = async () => { try { const result = await DocumentPicker.getDocumentAsync({type:'audio/*'}); if(!result.canceled&&result.assets&&result.assets.length>0) { const file=result.assets[0]; const newTrack: MusicTrack={id:Date.now().toString(),title:file.name,path:file.uri,isLocal:false,isFavorite:false}; const newList=[...playlist,newTrack]; setPlaylist(newList); AsyncStorage.setItem('musicPlaylist',JSON.stringify(newList)); } } catch(e) { showAlert('Error','Failed to pick audio file'); } };

//   const MiniPlayer = () => {
//     if (!currentTrack) return null;
//     return (
//       <TouchableOpacity activeOpacity={0.9} onPress={() => navigateTo('music')} style={styles.miniPlayerContainer}>
//         <View style={styles.miniProgressContainer}><View style={[styles.miniProgressFill,{width:`${(position/(duration||1))*100}%`}]} /></View>
//         <View style={styles.miniPlayerContent}>
//           <View style={styles.miniInfo}>
//             {currentTrack.artwork?(<Image source={{uri:currentTrack.artwork}} style={styles.miniArt}/>):(<Ionicons name="musical-note" size={20} color={COLORS.blue} style={{marginRight:10}}/>)}
//             <View><Text style={styles.miniTitle} numberOfLines={1}>{currentTrack.title}</Text><Text style={styles.miniTime}>{formatTime(position)} / {formatTime(duration)}</Text></View>
//           </View>
//           <View style={styles.miniControls}>
//             <TouchableOpacity onPress={(e)=>{e.stopPropagation();skipToPrev();}} style={styles.miniCtrlBtn}><Ionicons name="play-skip-back" size={20} color={COLORS.text}/></TouchableOpacity>
//             <TouchableOpacity onPress={(e)=>{e.stopPropagation();togglePlayPause();}} style={styles.miniCtrlBtn}><Ionicons name={isPlaying?"pause":"play"} size={26} color={COLORS.white}/></TouchableOpacity>
//             <TouchableOpacity onPress={(e)=>{e.stopPropagation();skipToNext();}} style={styles.miniCtrlBtn}><Ionicons name="play-skip-forward" size={20} color={COLORS.text}/></TouchableOpacity>
//           </View>
//         </View>
//       </TouchableOpacity>
//     );
//   };

//   const renderScreen = () => {
//     if (!userData&&screen!=='loading'&&screen!=='setup') return <LoadingScreen />;
//     switch (screen) {
//       case 'loading': return <LoadingScreen />;
//       case 'setup': return <SetupScreen onComplete={(data) => { setUserData(data); setScreenState('assessment'); }} />;
//       case 'assessment': return <AssessmentScreen userData={userData!} onComplete={(stats, calculatedLevel) => { const finalData={...userData!,level:calculatedLevel,assessmentStats:stats,createdAt:new Date().toISOString(),lastDailyQuestCompleted:getISODate(new Date())}; saveUserData(finalData); navigateTo('dashboard'); }} />;
//       case 'dashboard': return <DashboardScreen userData={userData!} onNavigate={navigateTo} onStartQuest={() => navigateTo('quest')} />;
//       case 'quest': return <QuestScreen userData={userData!} customPrograms={customPrograms} onBack={() => navigateTo('dashboard')} onStartTraining={(quest) => { setCurrentQuest(quest); setIsTraining(true); navigateTo('training'); }} />;
//       case 'training': return <TrainingScreen userData={userData!} quest={currentQuest!} showAlert={showAlert} onComplete={(results, duration) => { updateProgress(results, duration); navigateTo('dashboard'); }} onBack={() => { showAlert("Abort Mission?","Stop training?",[{text:"Cancel",style:"cancel"},{text:"Quit",style:"destructive",onPress:()=>navigateTo('dashboard')}]); }} />;
//       case 'stats': return <StatsScreen userData={userData!} onBack={() => navigateTo('dashboard')} />;
//       case 'music': return <MusicScreen playlist={playlist} currentTrack={currentTrack} isPlaying={isPlaying} isLoading={musicLoading} position={position} duration={duration} playbackMode={playbackMode} onPlay={playTrack} onPause={togglePlayPause} onSeek={seekTrack} onNext={skipToNext} onPrev={skipToPrev} onDelete={deleteTrack} onAdd={addMusicFile} onToggleMode={async () => { const modes: PlaybackMode[]=['loop_all','play_all','loop_one','play_one']; const nextMode=modes[(modes.indexOf(playbackMode)+1)%modes.length]; setPlaybackMode(nextMode); if(sound) await sound.setIsLoopingAsync(nextMode==='loop_one'); }} onBack={() => navigateTo('dashboard')} />;
//       case 'programs': return <CustomProgramsScreen userData={userData!} customPrograms={customPrograms} setCustomPrograms={updateCustomPrograms} onBack={() => navigateTo('dashboard')} onStartProgram={(quest) => { setCurrentQuest(quest); setIsTraining(true); navigateTo('training'); }} showAlert={showAlert} />;
//       case 'settings': return <SettingsScreen userData={userData!} onSave={(data) => { saveUserData(data); navigateTo('dashboard'); }} onBack={() => navigateTo('dashboard')} />;
//       case 'timers': return <TimersScreen onBack={() => navigateTo('dashboard')} />;
//       default: return <LoadingScreen />;
//     }
//   };

//   const updateProgress = async (results: TrainingResult, duration: number) => {
//     try {
//       let xpGained = currentQuest?.isDaily ? currentQuest.rewards.xp : 100;
//       if (currentQuest?.isDaily) { userData!.lastDailyQuestCompleted = getISODate(new Date()); }
//       const history = await AsyncStorage.getItem('trainingHistory'); const parsed: TrainingHistory[] = history ? JSON.parse(history) : [];
//       parsed.push({ date: new Date().toISOString(), quest: currentQuest!, results, xpGained, durationSeconds: duration });
//       await AsyncStorage.setItem('trainingHistory', JSON.stringify(parsed));
//       const xpNeeded = userData!.level*XP_PER_LEVEL_BASE; let newTotalXP = userData!.xp+xpGained; let newLevel = userData!.level; let leveledUp = false;
//       while (newTotalXP>=xpNeeded) { newTotalXP -= xpNeeded; newLevel++; leveledUp = true; }
//       const newUserData: UserData = { ...userData!, xp: newTotalXP, level: newLevel, totalWorkouts: (userData!.totalWorkouts||0)+1 };
//       if (leveledUp) showAlert('LEVEL UP!',`You have reached Level ${newLevel}!`); else showAlert('QUEST COMPLETED',`You gained ${xpGained} Experience Points.`);
//       saveUserData(newUserData);
//     } catch (error) { console.error('Error updating progress:',error); }
//   };

//   return (
//     <SafeAreaProvider>
//       <SafeAreaView style={styles.container} edges={['top','bottom']}>
//         <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} translucent={false} />
//         <View style={{ flex: 1 }}>{renderScreen()}</View>
//         {currentTrack&&screen!=='music'&&<MiniPlayer />}
//         <CustomAlert {...alertState} onClose={closeAlert} />
//       </SafeAreaView>
//     </SafeAreaProvider>
//   );
// }

// // --- Screens ---

// function LoadingScreen() {
//   const spinValue = useRef(new Animated.Value(0)).current;
//   useEffect(() => { Animated.loop(Animated.timing(spinValue,{toValue:1,duration:2000,useNativeDriver:true})).start(); }, []);
//   const spin = spinValue.interpolate({inputRange:[0,1],outputRange:['0deg','360deg']});
//   return (<View style={styles.centerContainer}><Animated.View style={{transform:[{rotate:spin}],marginBottom:20}}><Ionicons name="reload-circle-outline" size={60} color={COLORS.blue}/></Animated.View><Text style={styles.loadingTitle}>SOLO LEVELING</Text><Text style={styles.loadingSubtitle}>INITIALIZING SYSTEM...</Text></View>);
// }

// function SetupScreen({ onComplete }: { onComplete: (data: UserData) => void }) {
//   const [formData, setFormData] = useState<any>({ name:'', level:1, sex:'male', weight:'', height:'', goal:'muscle' });
//   const [image, setImage] = useState<string | null>(null);
//   const pickImage = async () => { let result = await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Images,allowsEditing:true,aspect:[1,1],quality:0.5}); if(!result.canceled) setImage(result.assets[0].uri); };
//   const handleNext = () => { if(!formData.name) return; onComplete({...formData,weight:parseFloat(formData.weight)||70,height:parseFloat(formData.height)||170,xp:0,totalWorkouts:0,createdAt:new Date().toISOString(),cameraEnabled:false,profileImage:image||undefined}); };
//   const GoalButton = ({ type, icon, label }: { type: GoalType, icon: string, label: string }) => (<TouchableOpacity style={[styles.goalBtn,formData.goal===type&&styles.goalBtnActive]} onPress={() => setFormData({...formData,goal:type})}><MaterialCommunityIcons name={icon as any} size={24} color={formData.goal===type?COLORS.white:COLORS.blue}/><Text style={formData.goal===type?styles.goalTextActive:styles.goalText}>{label}</Text></TouchableOpacity>);
//   return (
//     <ScrollView style={styles.screenContainer} contentContainerStyle={{padding:20}} showsVerticalScrollIndicator={false}>
//       <Text style={styles.headerTitle}>PLAYER REGISTRATION</Text>
//       <TouchableOpacity onPress={pickImage} style={styles.avatarPicker}>{image?(<Image source={{uri:image}} style={styles.avatarImage}/>):(<View style={styles.avatarPlaceholder}><Ionicons name="camera" size={40} color={COLORS.textDark}/><Text style={styles.avatarText}>ADD PHOTO</Text></View>)}</TouchableOpacity>
//       <View style={styles.formGroup}><Text style={styles.label}>HUNTER NAME</Text><TextInput style={styles.input} placeholder="Enter Name" placeholderTextColor={COLORS.textDark} onChangeText={t=>setFormData({...formData,name:t})}/></View>
//       <View style={styles.formGroup}><Text style={styles.label}>GOAL / CLASS</Text><GoalButton type="muscle" icon="arm-flex" label="Muscle & Strength"/><GoalButton type="weight_loss" icon="run-fast" label="Weight Loss"/><GoalButton type="speed_strength" icon="flash" label="Speed & Strength (Assassin)"/></View>
//       <View style={styles.formGroup}><Text style={styles.label}>GENDER</Text><View style={styles.genderContainer}><TouchableOpacity style={[styles.genderBtn,formData.sex==='male'&&styles.genderBtnActive]} onPress={() => setFormData({...formData,sex:'male'})}><Ionicons name="male" size={20} color={formData.sex==='male'?COLORS.white:COLORS.blue}/><Text style={formData.sex==='male'?styles.genderTextActive:styles.genderText}>MALE</Text></TouchableOpacity><TouchableOpacity style={[styles.genderBtn,formData.sex==='female'&&styles.genderBtnActive]} onPress={() => setFormData({...formData,sex:'female'})}><Ionicons name="female" size={20} color={formData.sex==='female'?COLORS.white:COLORS.blue}/><Text style={formData.sex==='female'?styles.genderTextActive:styles.genderText}>FEMALE</Text></TouchableOpacity></View></View>
//       <View style={styles.row}><View style={[styles.formGroup,{flex:1,marginRight:10}]}><Text style={styles.label}>WEIGHT (KG)</Text><TextInput style={styles.input} keyboardType="numeric" onChangeText={t=>setFormData({...formData,weight:t})}/></View><View style={[styles.formGroup,{flex:1}]}><Text style={styles.label}>HEIGHT (CM)</Text><TextInput style={styles.input} keyboardType="numeric" onChangeText={t=>setFormData({...formData,height:t})}/></View></View>
//       <TouchableOpacity style={styles.mainButton} onPress={handleNext}><Text style={styles.mainButtonText}>PROCEED TO EVALUATION</Text></TouchableOpacity>
//     </ScrollView>
//   );
// }

// function AssessmentScreen({ userData, onComplete }: { userData: UserData, onComplete: (stats: any, level: number) => void }) {
//   const [step, setStep] = useState<'intro'|'active'|'rest'|'input'>('intro');
//   const [currentExIndex, setCurrentExIndex] = useState(0);
//   const [timer, setTimer] = useState(0);
//   const [reps, setReps] = useState('');
//   const [results, setResults] = useState<{[key:string]:number}>({});
//   // Background timer support
//   const appStateRef = useRef(AppState.currentState);
//   const bgStartTimeRef = useRef<number | null>(null);
//   const timerRef = useRef(timer);
//   useEffect(() => { timerRef.current = timer; }, [timer]);

//   const getExercises = () => { if(userData.goal==='speed_strength') return ['pushups','jumpSquats','lunges']; else if(userData.goal==='weight_loss') return ['squats','situps','lunges']; else return ['pushups','squats','situps']; };
//   const exercises = getExercises(); const currentEx = exercises[currentExIndex]; const EX_TIME = 60; const REST_TIME = 15;

//   useEffect(() => {
//     const sub = AppState.addEventListener('change', nextState => {
//       if (appStateRef.current.match(/active/)&&nextState==='background') { bgStartTimeRef.current = Date.now(); }
//       if (appStateRef.current==='background'&&nextState==='active') {
//         if (bgStartTimeRef.current!==null) {
//           const elapsed = Math.floor((Date.now()-bgStartTimeRef.current)/1000);
//           bgStartTimeRef.current = null;
//           setTimer(prev => { const newVal = Math.max(0, prev-elapsed); return newVal; });
//         }
//       }
//       appStateRef.current = nextState;
//     });
//     return () => sub.remove();
//   }, []);

//   useEffect(() => {
//     let interval: NodeJS.Timeout;
//     if ((step==='active'||step==='rest')&&timer>0) {
//       interval = setInterval(() => {
//         setTimer(prev => {
//           if (prev<=1) {
//             if (step==='active') { Vibration.vibrate(); setStep('input'); }
//             else if (step==='rest') { if(currentExIndex<exercises.length-1) { setCurrentExIndex(prevIdx=>prevIdx+1); startExercise(); } else { finishAssessment(); } }
//             return 0;
//           }
//           return prev-1;
//         });
//       }, 1000);
//     }
//     return () => clearInterval(interval);
//   }, [step, timer]);

//   const startExercise = () => { setTimer(EX_TIME); setStep('active'); setReps(''); };
//   const handleInput = () => { const count=parseInt(reps)||0; setResults(prev=>({...prev,[currentEx]:count})); if(currentExIndex<exercises.length-1) { setTimer(REST_TIME); setStep('rest'); } else { finishAssessment(count); } };
//   const finishAssessment = (lastReps?: number) => { const finalResults=lastReps?{...results,[currentEx]:lastReps}:results; let totalReps=0; Object.values(finalResults).forEach(val=>totalReps+=val); const calculatedLevel=Math.max(1,Math.floor(totalReps/40)+1); onComplete(finalResults,calculatedLevel); };

//   return (
//     <View style={styles.centerContainer}>
//       <Text style={styles.headerTitle}>SYSTEM EVALUATION</Text>
//       {step==='intro'&&(<View style={{padding:20,alignItems:'center'}}><Text style={styles.questTitleDark}>RANKING TEST</Text><Text style={styles.alertMessage}>You will perform 3 exercises to determine your Hunter Rank. {"\n\n"}1 Minute MAX reps for each.{"\n"}15 Seconds rest between sets.</Text>{exercises.map(e=>(<View key={e} style={{flexDirection:'row',marginVertical:5}}><SoloIcon name={EXERCISES[e].iconName} lib={EXERCISES[e].iconLib} color={COLORS.blue}/><Text style={{color:COLORS.text,marginLeft:10}}>{EXERCISES[e].name}</Text></View>))}<TouchableOpacity style={styles.mainButton} onPress={startExercise}><Text style={styles.mainButtonText}>START TEST</Text></TouchableOpacity></View>)}
//       {step==='active'&&(
//         <View style={{alignItems:'center'}}>
//           <Text style={styles.loadingSubtitle}>CURRENT EXERCISE</Text><Text style={styles.loadingTitle}>{EXERCISES[currentEx].name}</Text>
//           <View style={styles.timerCircle}><Text style={styles.timerText}>{timer}</Text></View>
//           <Text style={styles.label}>DO AS MANY AS YOU CAN</Text>
//           {/* Skip button for assessment exercise */}
//           <TouchableOpacity style={[styles.mainButton,{backgroundColor:COLORS.accent,marginTop:15,paddingHorizontal:30}]} onPress={() => { Vibration.vibrate(); setTimer(0); setStep('input'); }}>
//             <Text style={[styles.mainButtonText,{color:COLORS.gold}]}>SKIP (ENTER RESULT)</Text>
//           </TouchableOpacity>
//         </View>
//       )}
//       {step==='input'&&(<View style={{alignItems:'center',width:'80%'}}><Text style={styles.questTitleDark}>TIME'S UP</Text><Text style={styles.label}>ENTER REPS COMPLETED:</Text><TextInput style={[styles.input,{textAlign:'center',fontSize:24,width:100}]} keyboardType="numeric" value={reps} onChangeText={setReps} autoFocus/><TouchableOpacity style={styles.mainButton} onPress={handleInput}><Text style={styles.mainButtonText}>CONFIRM</Text></TouchableOpacity></View>)}
//       {step==='rest'&&(
//         <View style={{alignItems:'center'}}>
//           <Text style={styles.loadingTitle}>REST</Text><Text style={styles.timerText}>{timer}</Text><Text style={styles.loadingSubtitle}>NEXT: {EXERCISES[exercises[currentExIndex+1]]?.name}</Text>
//           {/* Skip rest button */}
//           <TouchableOpacity style={[styles.mainButton,{backgroundColor:COLORS.accent,marginTop:20,paddingHorizontal:30}]} onPress={() => { setTimer(0); if(currentExIndex<exercises.length-1) { setCurrentExIndex(prev=>prev+1); startExercise(); } else finishAssessment(); }}>
//             <Text style={[styles.mainButtonText,{color:COLORS.gold}]}>SKIP REST</Text>
//           </TouchableOpacity>
//         </View>
//       )}
//     </View>
//   );
// }

// function DashboardScreen({ userData, onNavigate, onStartQuest }: any) {
//   if (!userData) return null;
//   const xpPercent = (Math.max(0,userData.xp)/(userData.level*XP_PER_LEVEL_BASE))*100;
//   return (
//     <ScrollView style={styles.screenContainer} showsVerticalScrollIndicator={false}>
//       <View style={styles.dashboardHeader}>
//         <View style={styles.profileRow}>
//           <Image source={userData.profileImage?{uri:userData.profileImage}:{uri:'https://via.placeholder.com/150'}} style={styles.profileImageSmall}/>
//           <View><Text style={styles.playerName}>{userData.name}</Text><Text style={styles.playerRank}>LEVEL {userData.level}</Text><Text style={{color:COLORS.gold,fontSize:10,letterSpacing:1}}>CLASS: {userData.goal.replace('_',' ').toUpperCase()}</Text></View>
//         </View>
//       </View>
//       <View style={styles.systemWindow}>
//         <Text style={styles.systemHeader}>STATUS</Text>
//         <View style={styles.xpBarContainer}><View style={[styles.xpBarFill,{width:`${xpPercent}%`}]}/></View>
//         <Text style={styles.xpText}>{userData.xp} / {userData.level*XP_PER_LEVEL_BASE} XP</Text>
//         <View style={styles.statGrid}>
//           <View style={styles.statItem}><Ionicons name="barbell-outline" size={20} color={COLORS.blue}/><Text style={styles.statVal}>{userData.totalWorkouts}</Text><Text style={styles.statLbl}>Raids</Text></View>
//           <View style={styles.statItem}><MaterialCommunityIcons name="fire" size={20} color={COLORS.danger}/><Text style={styles.statVal}>{userData.level}</Text><Text style={styles.statLbl}>Rank</Text></View>
//         </View>
//       </View>
//       <View style={styles.menuGrid}>
//         <TouchableOpacity style={styles.menuCardLarge} onPress={onStartQuest}><MaterialCommunityIcons name="sword-cross" size={40} color={COLORS.gold}/><Text style={styles.menuTitle}>DAILY QUEST</Text><Text style={styles.menuSub}>{userData.lastDailyQuestCompleted===getISODate(new Date())?'Completed':'Available'}</Text></TouchableOpacity>
//         <View style={styles.menuRow}>
//           <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('programs')}><Ionicons name="list" size={24} color={COLORS.blue}/><Text style={styles.menuTitleSmall}>Programs</Text></TouchableOpacity>
//           <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('stats')}><Ionicons name="stats-chart" size={24} color={COLORS.success}/><Text style={styles.menuTitleSmall}>Stats</Text></TouchableOpacity>
//         </View>
//         <View style={styles.menuRow}>
//           <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('music')}><Ionicons name="musical-notes" size={24} color={COLORS.purple}/><Text style={styles.menuTitleSmall}>Music</Text></TouchableOpacity>
//           <TouchableOpacity style={styles.menuCardSmall} onPress={() => onNavigate('timers')}><Ionicons name="timer-outline" size={24} color={COLORS.gold}/><Text style={styles.menuTitleSmall}>Timers</Text></TouchableOpacity>
//         </View>
//         <View style={styles.menuRow}>
//           <TouchableOpacity style={[styles.menuCardSmall,{width:'100%'}]} onPress={() => onNavigate('settings')}><Ionicons name="settings" size={24} color={COLORS.textDark}/><Text style={styles.menuTitleSmall}>Settings</Text></TouchableOpacity>
//         </View>
//       </View>
//     </ScrollView>
//   );
// }

// // --- Timers Screen ---
// function TimersScreen({ onBack }: { onBack: () => void }) {
//   const [customTimers, setCustomTimers] = useState<CustomTimer[]>([]);
//   const [activeTimers, setActiveTimers] = useState<{[id:string]: number}>({});
//   const [runningTimers, setRunningTimers] = useState<{[id:string]: boolean}>({});
//   const [newLabel, setNewLabel] = useState('');
//   const [newMinutes, setNewMinutes] = useState('30');
//   const [newSeconds, setNewSeconds] = useState('0');
//   const intervalsRef = useRef<{[id:string]: NodeJS.Timeout}>({});
//   const bgStartRef = useRef<{[id:string]: number}>({});
//   const appStateRef = useRef(AppState.currentState);

//   useEffect(() => {
//     AsyncStorage.getItem('customTimers').then(data => { if(data) { const timers: CustomTimer[] = JSON.parse(data); setCustomTimers(timers); const init: {[id:string]:number}={}; timers.forEach(t=>init[t.id]=t.seconds); setActiveTimers(init); } });
//   }, []);

//   // Background support for all running timers
//   useEffect(() => {
//     const sub = AppState.addEventListener('change', nextState => {
//       if (appStateRef.current.match(/active/)&&nextState==='background') { Object.keys(runningTimers).forEach(id => { if(runningTimers[id]) bgStartRef.current[id]=Date.now(); }); }
//       if (appStateRef.current==='background'&&nextState==='active') {
//         const elapsed: {[id:string]:number}={};
//         Object.keys(bgStartRef.current).forEach(id => { elapsed[id]=Math.floor((Date.now()-bgStartRef.current[id])/1000); delete bgStartRef.current[id]; });
//         if (Object.keys(elapsed).length>0) setActiveTimers(prev => { const next={...prev}; Object.keys(elapsed).forEach(id => { next[id]=Math.max(0,(next[id]||0)-elapsed[id]); }); return next; });
//       }
//       appStateRef.current = nextState;
//     });
//     return () => sub.remove();
//   }, [runningTimers]);

//   const saveTimers = async (timers: CustomTimer[]) => { setCustomTimers(timers); await AsyncStorage.setItem('customTimers', JSON.stringify(timers)); };

//   const addTimer = () => {
//     const mins = parseInt(newMinutes)||0; const secs = parseInt(newSeconds)||0; const total = mins*60+secs;
//     if (total<=0) return;
//     const id = Date.now().toString();
//     const timer: CustomTimer = { id, label: newLabel||`${mins}m ${secs>0?secs+'s':''}`, seconds: total };
//     const updated = [...customTimers, timer];
//     saveTimers(updated);
//     setActiveTimers(prev => ({...prev,[id]:total}));
//     setNewLabel(''); setNewMinutes('30'); setNewSeconds('0');
//   };

//   const deleteTimer = (id: string) => {
//     if (intervalsRef.current[id]) { clearInterval(intervalsRef.current[id]); delete intervalsRef.current[id]; }
//     setRunningTimers(prev => { const n={...prev}; delete n[id]; return n; });
//     setActiveTimers(prev => { const n={...prev}; delete n[id]; return n; });
//     saveTimers(customTimers.filter(t=>t.id!==id));
//   };

//   const startTimer = (id: string) => {
//     if (intervalsRef.current[id]) return;
//     setRunningTimers(prev => ({...prev,[id]:true}));
//     intervalsRef.current[id] = setInterval(() => {
//       setActiveTimers(prev => {
//         const cur = (prev[id]||0); if(cur<=1) { clearInterval(intervalsRef.current[id]); delete intervalsRef.current[id]; setRunningTimers(p=>({...p,[id]:false})); Vibration.vibrate([0,500,200,500]); return {...prev,[id]:0}; }
//         return {...prev,[id]:cur-1};
//       });
//     }, 1000);
//   };

//   const pauseTimer = (id: string) => { if(intervalsRef.current[id]) { clearInterval(intervalsRef.current[id]); delete intervalsRef.current[id]; } setRunningTimers(prev=>({...prev,[id]:false})); };

//   const resetTimer = (id: string) => {
//     pauseTimer(id);
//     const original = customTimers.find(t=>t.id===id);
//     if (original) setActiveTimers(prev=>({...prev,[id]:original.seconds}));
//   };

//   useEffect(() => { return () => { Object.values(intervalsRef.current).forEach(clearInterval); }; }, []);

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>TIMERS</Text><View style={{width:24}}/></View>
//       <ScrollView style={{padding:20}} showsVerticalScrollIndicator={false}>
//         {/* Add Timer */}
//         <View style={{backgroundColor:COLORS.secondary,borderRadius:12,padding:15,marginBottom:20,borderWidth:1,borderColor:COLORS.accent}}>
//           <Text style={[styles.label,{marginBottom:10}]}>CREATE NEW TIMER</Text>
//           <TextInput style={[styles.input,{marginBottom:8}]} placeholder="Label (optional)" placeholderTextColor={COLORS.textDark} value={newLabel} onChangeText={setNewLabel}/>
//           <View style={styles.row}>
//             <View style={{flex:1,marginRight:8}}><Text style={styles.label}>MINUTES</Text><TextInput style={styles.input} keyboardType="numeric" value={newMinutes} onChangeText={setNewMinutes}/></View>
//             <View style={{flex:1}}><Text style={styles.label}>SECONDS</Text><TextInput style={styles.input} keyboardType="numeric" value={newSeconds} onChangeText={setNewSeconds}/></View>
//           </View>
//           <TouchableOpacity style={[styles.mainButton,{marginTop:10}]} onPress={addTimer}><Text style={styles.mainButtonText}>ADD TIMER</Text></TouchableOpacity>
//         </View>

//         {customTimers.length===0&&<Text style={{color:COLORS.textDark,textAlign:'center',marginTop:20}}>No timers yet. Create one above!</Text>}
//         {customTimers.map(timer => {
//           const remaining = activeTimers[timer.id]??timer.seconds;
//           const isRunning = runningTimers[timer.id]||false;
//           const progress = remaining/timer.seconds;
//           const finished = remaining===0;
//           return (
//             <View key={timer.id} style={{backgroundColor:COLORS.secondary,borderRadius:12,padding:20,marginBottom:15,borderWidth:1,borderColor:finished?COLORS.gold:isRunning?COLORS.blue:COLORS.accent}}>
//               <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
//                 <Text style={{color:COLORS.text,fontWeight:'bold',fontSize:16}}>{timer.label}</Text>
//                 <TouchableOpacity onPress={() => deleteTimer(timer.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger}/></TouchableOpacity>
//               </View>
//               {/* Progress bar */}
//               <View style={{height:4,backgroundColor:COLORS.accent,borderRadius:2,marginBottom:12}}><View style={{height:'100%',width:`${Math.max(0,progress*100)}%`,backgroundColor:finished?COLORS.gold:COLORS.blue,borderRadius:2}}/></View>
//               {/* Big timer display */}
//               <Text style={{color:finished?COLORS.gold:COLORS.white,fontSize:48,fontWeight:'900',textAlign:'center',letterSpacing:2,marginBottom:12}}>{formatTime(remaining)}</Text>
//               {finished&&<Text style={{color:COLORS.gold,textAlign:'center',fontWeight:'bold',letterSpacing:2,marginBottom:8}}>⚡ TIME'S UP!</Text>}
//               <View style={{flexDirection:'row',justifyContent:'center'}}>
//                 <TouchableOpacity style={[styles.timerCtrlBtn,{backgroundColor:isRunning?COLORS.accent:COLORS.blue,marginRight:10}]} onPress={() => isRunning?pauseTimer(timer.id):startTimer(timer.id)}>
//                   <Ionicons name={isRunning?"pause":"play"} size={22} color={COLORS.white}/>
//                   <Text style={styles.timerCtrlText}>{isRunning?'PAUSE':'START'}</Text>
//                 </TouchableOpacity>
//                 <TouchableOpacity style={[styles.timerCtrlBtn,{backgroundColor:COLORS.accent}]} onPress={() => resetTimer(timer.id)}>
//                   <Ionicons name="refresh" size={22} color={COLORS.text}/>
//                   <Text style={styles.timerCtrlText}>RESET</Text>
//                 </TouchableOpacity>
//               </View>
//             </View>
//           );
//         })}
//       </ScrollView>
//     </View>
//   );
// }

// function MusicScreen({ playlist, currentTrack, isPlaying, isLoading, position, duration, playbackMode, onPlay, onPause, onSeek, onNext, onPrev, onDelete, onAdd, onToggleMode, onBack }: any) {
//   const [searchQuery, setSearchQuery] = useState('');
//   const getModeIcon = () => { switch(playbackMode) { case 'loop_one': return 'repeat-once'; case 'loop_all': return 'repeat'; case 'play_one': return 'numeric-1-box-outline'; case 'play_all': return 'playlist-play'; default: return 'repeat'; } };
//   const filteredPlaylist = playlist.filter((track: MusicTrack) => track.title.toLowerCase().includes(searchQuery.toLowerCase()));
//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>MUSIC PLAYER</Text><TouchableOpacity onPress={onToggleMode} style={styles.modeBtnHeader}><MaterialCommunityIcons name={getModeIcon()} size={20} color={COLORS.blue}/></TouchableOpacity></View>
//       <View style={styles.playerMain}>
//         {currentTrack&&currentTrack.artwork?(<Image source={{uri:currentTrack.artwork}} style={styles.albumArt}/>):(<View style={styles.albumArtPlaceholder}><Ionicons name="musical-note" size={80} color={COLORS.highlight}/></View>)}
//         <Text style={styles.nowPlayingTitle} numberOfLines={1}>{currentTrack?currentTrack.title:'Select a Track'}</Text>
//         <View style={styles.seekContainer}><Text style={styles.timeText}>{formatTime(position)}</Text><Slider style={{flex:1,marginHorizontal:10}} minimumValue={0} maximumValue={duration>0?duration:1} value={position} minimumTrackTintColor={COLORS.highlight} maximumTrackTintColor={COLORS.accent} thumbTintColor={COLORS.blue} onSlidingComplete={onSeek}/><Text style={styles.timeText}>{formatTime(duration)}</Text></View>
//         <View style={styles.playerControlsMain}>
//           <TouchableOpacity onPress={onPrev} style={styles.ctrlBtn}><Ionicons name="play-skip-back" size={30} color={COLORS.text}/></TouchableOpacity>
//           <TouchableOpacity onPress={onPause} style={styles.playButtonLarge}>{isLoading?(<View style={{width:30,height:30,borderWidth:3,borderRadius:15,borderColor:COLORS.primary,borderTopColor:COLORS.blue}}/>):(<Ionicons name={isPlaying?"pause":"play"} size={40} color={COLORS.primary}/>)}</TouchableOpacity>
//           <TouchableOpacity onPress={onNext} style={styles.ctrlBtn}><Ionicons name="play-skip-forward" size={30} color={COLORS.text}/></TouchableOpacity>
//         </View>
//       </View>
//       <View style={styles.playlistHeader}><Text style={styles.sectionTitle}>PLAYLIST</Text><TouchableOpacity onPress={onAdd} style={styles.addBtn}><Ionicons name="add" size={20} color={COLORS.primary}/></TouchableOpacity></View>
//       <View style={{paddingHorizontal:20,marginBottom:5}}><View style={styles.searchContainer}><Ionicons name="search" size={20} color={COLORS.textDark}/><TextInput style={styles.searchInput} placeholder="Search tracks..." placeholderTextColor={COLORS.textDark} value={searchQuery} onChangeText={setSearchQuery}/></View></View>
//       <ScrollView style={styles.playlistContainer} contentContainerStyle={{paddingBottom:20}} showsVerticalScrollIndicator={false}>
//         {filteredPlaylist.map((track: MusicTrack) => (
//           <View key={track.id} style={[styles.trackRow,currentTrack?.id===track.id&&styles.trackActive]}>
//             <TouchableOpacity style={styles.trackInfoArea} onPress={() => onPlay(track)}><View style={styles.trackIcon}><Ionicons name="musical-notes-outline" size={20} color={currentTrack?.id===track.id?COLORS.white:COLORS.textDark}/></View><Text style={[styles.trackName,currentTrack?.id===track.id&&styles.trackNameActive]} numberOfLines={1}>{track.title}</Text></TouchableOpacity>
//             <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(track.id)}><Ionicons name="trash-outline" size={18} color={COLORS.danger}/></TouchableOpacity>
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
//   const [manualInputs, setManualInputs] = useState<{[key:string]:string}>({});
//   const cameraRef = useRef<any>(null);
//   const appStateRef = useRef(AppState.currentState);
//   const bgStartRef = useRef<number | null>(null);
//   const workoutTimeRef = useRef(0);
//   useEffect(() => { workoutTimeRef.current = workoutTime; }, [workoutTime]);

//   useEffect(() => {
//     if (!permission) requestPermission();
//     const initCounts: any = {}; Object.keys(quest.exercises).forEach(k => initCounts[k]=0); setCounts(initCounts);
//   }, [permission]);

//   // Background-aware workout timer
//   useEffect(() => {
//     const sub = AppState.addEventListener('change', nextState => {
//       if (appStateRef.current.match(/active/)&&nextState==='background') { bgStartRef.current=Date.now(); }
//       if (appStateRef.current==='background'&&nextState==='active') { if(bgStartRef.current!==null) { const elapsed=Math.floor((Date.now()-bgStartRef.current)/1000); bgStartRef.current=null; setWorkoutTime(t=>t+elapsed); } }
//       appStateRef.current = nextState;
//     });
//     return () => sub.remove();
//   }, []);

//   useEffect(() => { const timer = setInterval(() => { setWorkoutTime(t=>t+1); }, 1000); return () => clearInterval(timer); }, []);

//   const handleManualAdd = (ex: string, target: number) => { const amount=parseInt(manualInputs[ex]||'0'); if(amount>0) { const current=counts[ex]||0; const newVal=Math.min(current+amount,target); setCounts({...counts,[ex]:newVal}); setManualInputs({...manualInputs,[ex]:''}); } };
//   const handleDecrease = (ex: string) => { const current=counts[ex]||0; if(current>0) setCounts({...counts,[ex]:current-1}); };
//   const handleCheckAll = () => { showAlert("Complete All?","Mark all exercises as finished?",[{text:"Cancel",style:"cancel"},{text:"Yes",onPress:()=>setCounts(quest.exercises)}]); };
//   const isCompleted = (ex: string) => (counts[ex]||0)>=quest.exercises[ex];
//   const allCompleted = Object.keys(quest.exercises).every(isCompleted);
//   const isPoseSupported = (exKey: string) => PoseCalculator.isSupported(exKey);

//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}>
//         <TouchableOpacity onPress={onBack}><Ionicons name="close" size={24} color={COLORS.danger}/></TouchableOpacity>
//         <Text style={styles.headerTitle}>DUNGEON INSTANCE</Text>
//         <TouchableOpacity onPress={() => setCameraType(cameraType==='back'?'front':'back')}><Ionicons name="camera-reverse" size={24} color={COLORS.blue}/></TouchableOpacity>
//       </View>

//       {/* Big workout timer above exercises */}
//       <View style={styles.workoutTimerBanner}>
//         <Ionicons name="timer-outline" size={20} color={COLORS.gold}/>
//         <Text style={styles.workoutTimerText}>{formatTime(workoutTime)}</Text>
//       </View>

//       {userData.cameraEnabled&&(
//         <View style={styles.cameraContainer}>
//           {permission?.granted?(
//             <CameraView style={styles.camera} facing={cameraType as any} ref={cameraRef}>
//               <View style={styles.cameraOverlay}>
//                 <Text style={styles.detectionText}>SYSTEM: POSE TRACKING ACTIVE</Text>
//                 {activeExercise&&!isPoseSupported(activeExercise)?(<View style={styles.camWarningBox}><Text style={styles.camWarningText}>CANNOT DETECT WITH CAM</Text></View>):(<View style={styles.poseBox}/>)}
//                 {activeExercise&&isPoseSupported(activeExercise)&&(<View style={styles.poseInfoBox}><Text style={styles.poseInfoText}>Detecting: {EXERCISES[activeExercise]?.name||activeExercise}</Text><Text style={styles.poseInfoSub}>Ensure full body visibility</Text></View>)}
//               </View>
//             </CameraView>
//           ):(
//             <View style={styles.cameraOff}><Ionicons name="videocam-off" size={40} color={COLORS.textDark}/><Text style={styles.cameraOffText}>CAMERA DISABLED</Text><Text style={styles.cameraOffSub}>Enable in Settings for Auto-Count</Text></View>
//           )}
//         </View>
//       )}

//       <ScrollView style={styles.exerciseList} contentContainerStyle={{paddingBottom:20}} showsVerticalScrollIndicator={false}>
//         {Object.entries(quest.exercises).map(([key, target]: [string, any]) => {
//           const def = quest.customExercises?.[key]||EXERCISES[key]||{name:key,iconName:'help',iconLib:'Ionicons'};
//           const count = counts[key]||0; const completed = isCompleted(key);
//           return (
//             <TouchableOpacity key={key} style={[styles.exerciseCard,completed&&styles.exerciseCardDone,activeExercise===key&&styles.exerciseCardActive]} onPress={() => setActiveExercise(key)}>
//               <View style={styles.exHeaderRow}>
//                 <View style={styles.exIcon}><SoloIcon name={def.iconName} lib={def.iconLib} size={28} color={COLORS.blue}/></View>
//                 <View style={{flex:1}}><Text style={styles.exName}>{def.name}</Text><View style={styles.progressBarBg}><View style={[styles.progressBarFill,{width:`${Math.min((count/target)*100,100)}%`}]}/></View></View>
//                 <Text style={styles.countTextLarge}>{count}/{target}</Text>
//               </View>
//               <View style={styles.seriesControls}>
//                 <TouchableOpacity style={styles.seriesBtnSmall} onPress={() => handleDecrease(key)} disabled={count===0}><Ionicons name="remove" size={16} color={COLORS.white}/></TouchableOpacity>
//                 <TextInput style={styles.seriesInput} placeholder="#" placeholderTextColor={COLORS.textDark} keyboardType="numeric" value={manualInputs[key]||''} onChangeText={(t) => setManualInputs({...manualInputs,[key]:t})}/>
//                 <TouchableOpacity style={styles.seriesBtn} onPress={() => handleManualAdd(key,target)} disabled={completed}><Text style={styles.seriesBtnText}>ADD SET</Text></TouchableOpacity>
//                 <TouchableOpacity style={[styles.checkBtn,completed?styles.checkBtnDone:{}]} onPress={() => setCounts({...counts,[key]:target})}><Ionicons name="checkmark" size={18} color={COLORS.white}/></TouchableOpacity>
//               </View>
//             </TouchableOpacity>
//           );
//         })}
//         <TouchableOpacity style={styles.checkAllBtn} onPress={handleCheckAll}><Text style={styles.checkAllText}>COMPLETE ALL EXERCISES</Text></TouchableOpacity>
//         {allCompleted&&(<TouchableOpacity style={styles.completeBtn} onPress={() => onComplete(counts,workoutTime)}><Text style={styles.completeBtnText}>COMPLETE DUNGEON</Text></TouchableOpacity>)}
//       </ScrollView>
//     </View>
//   );
// }

// function CustomProgramsScreen({ userData, customPrograms, setCustomPrograms, onBack, onStartProgram, showAlert }: any) {
//   const [modalVisible, setModalVisible] = useState(false);
//   const [newProgName, setNewProgName] = useState(''); const [editingId, setEditingId] = useState<string|null>(null);
//   const [selectedEx, setSelectedEx] = useState<{[key:string]:number}>({}); const [customList, setCustomList] = useState<Array<{id:string,name:string,reps:number}>>([]); const [customExName, setCustomExName] = useState(''); const [customExCount, setCustomExCount] = useState('10'); const [schedule, setSchedule] = useState<string[]>([]);
//   const toggleExercise = (key: string) => { const next={...selectedEx}; if(next[key]) delete next[key]; else next[key]=10; setSelectedEx(next); };
//   const updateReps = (key: string, val: string) => { setSelectedEx({...selectedEx,[key]:parseInt(val)||0}); };
//   const addCustomExercise = () => { if(!customExName) { showAlert("Error","Enter name"); return; } const newEx={id:`cust_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,name:customExName,reps:parseInt(customExCount)||10}; setCustomList([...customList,newEx]); setCustomExName(''); setCustomExCount('10'); };
//   const removeCustomExercise = (id: string) => { setCustomList(customList.filter(item=>item.id!==id)); };
//   const toggleDay = (day: string) => { if(schedule.includes(day)) setSchedule(schedule.filter(d=>d!==day)); else setSchedule([...schedule,day]); };
//   const openCreateModal = () => { setNewProgName(''); setEditingId(null); setSelectedEx({}); setCustomList([]); setSchedule([]); setModalVisible(true); };
//   const openEditModal = (prog: CustomProgram) => { setNewProgName(prog.name); setEditingId(prog.id); setSchedule(prog.schedule||[]); const stdEx: {[key:string]:number}={}; const cList: Array<{id:string,name:string,reps:number}>=[];  Object.entries(prog.exercises).forEach(([key,reps])=>{ if(EXERCISES[key]) stdEx[key]=reps; else if(prog.customExercises&&prog.customExercises[key]) cList.push({id:key,name:prog.customExercises[key].name,reps:reps}); }); setSelectedEx(stdEx); setCustomList(cList); setModalVisible(true); };
//   const saveProgram = () => { if(!newProgName) { showAlert("Error","Name required"); return; } let customDefs: ExerciseConfig={}; let finalExercises={...selectedEx}; customList.forEach(item=>{customDefs[item.id]={name:item.name,iconName:'star',iconLib:'Ionicons',custom:true,type:'reps'};finalExercises[item.id]=item.reps;}); const newProg: CustomProgram={id:editingId?editingId:Date.now().toString(),name:newProgName,exercises:finalExercises,customExercises:customDefs,schedule,createdAt:new Date().toISOString()}; let updated; if(editingId) updated=customPrograms.map((p:any)=>p.id===editingId?newProg:p); else updated=[...customPrograms,newProg]; setCustomPrograms(updated); setModalVisible(false); };
//   const deleteProgram = (id: string) => { setCustomPrograms(customPrograms.filter((p:any)=>p.id!==id)); };
//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>CUSTOM PROGRAMS</Text><TouchableOpacity onPress={openCreateModal}><Ionicons name="add-circle" size={30} color={COLORS.blue}/></TouchableOpacity></View>
//       <ScrollView style={{padding:20}} showsVerticalScrollIndicator={false}>
//         {customPrograms.map((p:any) => (
//           <View key={p.id} style={styles.programCard}>
//             <View style={{flex:1}}><Text style={styles.progTitle}>{p.name}</Text><Text style={styles.progSub}>{Object.keys(p.exercises).length} Exercises</Text>{p.schedule&&p.schedule.length>0&&<Text style={{color:COLORS.gold,fontSize:10}}>Scheduled: {p.schedule.join(', ')}</Text>}</View>
//             <TouchableOpacity style={styles.startBtnSmall} onPress={() => onStartProgram({title:p.name,difficulty:1,exercises:p.exercises,rewards:{xp:100,title:'Custom'},customExercises:p.customExercises,isDaily:false})}><Text style={styles.btnTextSmall}>START</Text></TouchableOpacity>
//             <TouchableOpacity style={styles.editProgBtn} onPress={() => openEditModal(p)}><Ionicons name="create-outline" size={20} color={COLORS.white}/></TouchableOpacity>
//             <TouchableOpacity style={styles.deleteProgBtn} onPress={() => deleteProgram(p.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger}/></TouchableOpacity>
//           </View>
//         ))}
//       </ScrollView>
//       <Modal visible={modalVisible} animationType="slide" transparent>
//         <View style={styles.modalOverlay}>
//           <View style={styles.createModal}>
//             <Text style={styles.modalTitle}>{editingId?'EDIT PROGRAM':'NEW PROGRAM'}</Text>
//             <TextInput style={styles.input} placeholder="Program Name" placeholderTextColor={COLORS.textDark} value={newProgName} onChangeText={setNewProgName}/>
//             <Text style={[styles.label,{marginTop:10}]}>Schedule as Daily Quest:</Text>
//             <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:10}}>{WEEK_DAYS.map(day=>(<TouchableOpacity key={day} onPress={()=>toggleDay(day)} style={[styles.dayBtn,schedule.includes(day)&&styles.dayBtnActive]}><Text style={[styles.dayBtnText,schedule.includes(day)&&{color:COLORS.white}]}>{day.charAt(0)}</Text></TouchableOpacity>))}</View>
//             <ScrollView style={{height:200,marginVertical:10}} showsVerticalScrollIndicator={false}>
//               {Object.entries(EXERCISES).map(([k,v])=>(<View key={k} style={styles.selectRowContainer}><Text style={styles.rowLabel}>{v.name}</Text><View style={{flexDirection:'row',alignItems:'center'}}>{selectedEx[k]?(<TextInput style={styles.repsInput} keyboardType="numeric" value={String(selectedEx[k])} onChangeText={(val)=>updateReps(k,val)}/>):null}<TouchableOpacity style={[styles.checkboxBtn,selectedEx[k]?styles.checkboxActive:{}]} onPress={()=>toggleExercise(k)}><Ionicons name={selectedEx[k]?"remove":"add"} size={20} color={selectedEx[k]?COLORS.white:COLORS.blue}/></TouchableOpacity></View></View>))}
//               {customList.length>0&&<Text style={[styles.label,{marginTop:15}]}>Added Custom:</Text>}
//               {customList.map(item=>(<View key={item.id} style={styles.selectRowContainer}><View style={{flex:1}}><Text style={styles.rowLabel}>{item.name} ({item.reps} reps)</Text></View><TouchableOpacity style={styles.deleteBtn} onPress={()=>removeCustomExercise(item.id)}><Ionicons name="trash-outline" size={20} color={COLORS.danger}/></TouchableOpacity></View>))}
//             </ScrollView>
//             <View style={{borderTopWidth:1,borderTopColor:COLORS.accent,paddingTop:10}}>
//               <Text style={styles.label}>Add Custom Exercise:</Text>
//               <View style={styles.row}>
//                 <TextInput style={[styles.input,{flex:2,marginRight:5}]} placeholder="Name" placeholderTextColor={COLORS.textDark} value={customExName} onChangeText={setCustomExName}/>
//                 <TextInput style={[styles.input,{flex:1,marginRight:5}]} keyboardType="numeric" placeholder="Reps" placeholderTextColor={COLORS.textDark} value={customExCount} onChangeText={setCustomExCount}/>
//                 <TouchableOpacity style={styles.addCustomBtn} onPress={addCustomExercise}><Ionicons name="add" size={24} color={COLORS.white}/></TouchableOpacity>
//               </View>
//             </View>
//             <View style={[styles.row,{marginTop:10}]}><TouchableOpacity style={styles.cancelBtn} onPress={()=>setModalVisible(false)}><Text style={styles.btnText}>CANCEL</Text></TouchableOpacity><TouchableOpacity style={styles.saveBtn} onPress={saveProgram}><Text style={styles.btnText}>SAVE</Text></TouchableOpacity></View>
//           </View>
//         </View>
//       </Modal>
//     </View>
//   );
// }

// function StatsScreen({ userData, onBack }: any) {
//   const [data, setData] = useState<number[]>([0]);
//   useEffect(() => { AsyncStorage.getItem('trainingHistory').then(h => { if(h) { const history=JSON.parse(h); const grouped: {[key:string]:number}={}; history.forEach((entry: TrainingHistory) => { const dateKey=entry.date.split('T')[0]; grouped[dateKey]=(grouped[dateKey]||0)+entry.xpGained; }); const sortedKeys=Object.keys(grouped).sort(); const xpData=sortedKeys.map(k=>grouped[k]); if(xpData.length>0) setData(xpData.slice(-6)); else setData([0]); } }); }, []);
//   return (
//     <ScrollView style={styles.screenContainer} showsVerticalScrollIndicator={false}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>STATISTICS</Text><View style={{width:24}}/></View>
//       <View style={{padding:20}}>
//         <Text style={styles.sectionTitle}>XP GAIN HISTORY</Text>
//         <LineChart data={{labels:["1","2","3","4","5","6"],datasets:[{data}]}} width={width-40} height={220} yAxisLabel="" yAxisSuffix=" XP" chartConfig={{backgroundColor:COLORS.secondary,backgroundGradientFrom:COLORS.secondary,backgroundGradientTo:COLORS.accent,decimalPlaces:0,color:(opacity=1)=>`rgba(59,130,246,${opacity})`,labelColor:(opacity=1)=>`rgba(255,255,255,${opacity})`,style:{borderRadius:16},propsForDots:{r:"6",strokeWidth:"2",stroke:COLORS.glow}}} style={{marginVertical:8,borderRadius:16}} bezier/>
//         <View style={styles.statBoxLarge}><Text style={styles.bigStat}>{userData.totalWorkouts}</Text><Text style={styles.bigStatLbl}>TOTAL DUNGEONS CLEARED</Text></View>
//       </View>
//     </ScrollView>
//   );
// }

// function QuestScreen({ userData, customPrograms, onBack, onStartTraining }: any) {
//   const getDailyQuest = (): Quest => {
//     const todayDay = getDayString(new Date()); const scheduledProg = customPrograms.find((p: CustomProgram) => p.schedule&&p.schedule.includes(todayDay));
//     if (scheduledProg) return { title:`DAILY: ${scheduledProg.name.toUpperCase()}`, difficulty:Math.floor(userData.level/5)+1, exercises:scheduledProg.exercises, customExercises:scheduledProg.customExercises, rewards:{xp:userData.level*100,title:'Hunter'}, isDaily:true };
//     const level=userData.level; let exercises: {[key:string]:number}={}; let title="DAILY QUEST"; let rewardXP=level*100;
//     if (userData.goal==='speed_strength') { title="ASSASSIN TRAINING"; exercises={clapPushups:Math.ceil(level*5),jumpSquats:Math.ceil(level*10),situps:Math.ceil(level*10),running:Math.min(1+(level*0.2),5)}; }
//     else if (userData.goal==='weight_loss') { title="ENDURANCE TRIAL"; exercises={squats:level*15,situps:level*15,burpees:level*5,running:Math.min(2+(level*0.5),10)}; }
//     else { title="STRENGTH TRAINING"; exercises={pushups:level*10,squats:level*10,situps:level*10,pullups:Math.ceil(level*2)}; }
//     return { title, difficulty:Math.floor(level/5)+1, exercises, rewards:{xp:rewardXP,title:'Hunter'}, isDaily:true };
//   };
//   const dailyQuest = getDailyQuest(); const [expanded, setExpanded] = useState(false);
//   const MAX_PREVIEW = 14; const exerciseEntries = Object.entries(dailyQuest.exercises); const hasMore = exerciseEntries.length>MAX_PREVIEW; const visibleExercises = expanded?exerciseEntries:exerciseEntries.slice(0,MAX_PREVIEW);
//   const isCompleted = userData.lastDailyQuestCompleted===getISODate(new Date());
//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>QUEST INFO</Text><View style={{width:24}}/></View>
//       <ScrollView style={{flex:1}} contentContainerStyle={{paddingBottom:10}} showsVerticalScrollIndicator={false}>
//         <View style={styles.questPaperDark}>
//           <Text style={styles.questTitleDark}>{dailyQuest.title}</Text>
//           <Text style={styles.difficulty}>Rank: {'★'.repeat(dailyQuest.difficulty)}</Text>
//           <View style={styles.divider}/>
//           <Text style={styles.objTitleDark}>OBJECTIVES:</Text>
//           {visibleExercises.map(([k,v]) => (<View key={k} style={[styles.objRow,{marginTop:5}]}><View style={{flexDirection:'row',alignItems:'center'}}><View style={{width:6,height:6,backgroundColor:COLORS.blue,marginRight:8}}/><Text style={styles.objTextDark}>{(dailyQuest.customExercises?.[k]?.name)||EXERCISES[k]?.name||k}</Text></View><Text style={styles.objValDark}>{String(v)}{EXERCISES[k]?.type==='distance'?' km':''}</Text></View>))}
//           {hasMore&&(<TouchableOpacity onPress={()=>setExpanded(!expanded)} style={styles.expandBtn}><Text style={styles.expandBtnText}>{expanded?'▲  SHOW LESS':`▼  +${exerciseEntries.length-MAX_PREVIEW} MORE OBJECTIVES`}</Text></TouchableOpacity>)}
//           <View style={styles.divider}/>
//           <Text style={styles.rewardTitleDark}>REWARDS:</Text>
//           <Text style={styles.rewardText}>+ {dailyQuest.rewards.xp} XP {isCompleted&&<Text style={{color:COLORS.gold}}>(REPEAT FOR BONUS XP)</Text>}</Text>
//         </View>
//       </ScrollView>
//       <View style={{paddingHorizontal:20,paddingTop:10,paddingBottom:10,borderTopWidth:1,borderTopColor:COLORS.accent,backgroundColor:COLORS.primary}}>
//         <TouchableOpacity style={[styles.acceptBtn,{marginBottom:0}]} onPress={() => onStartTraining(dailyQuest)}>
//           <Text style={styles.acceptBtnText}>{isCompleted?'REPEAT QUEST (+XP)':'ACCEPT QUEST'}</Text>
//         </TouchableOpacity>
//       </View>
//     </View>
//   );
// }

// function SettingsScreen({ userData, onSave, onBack }: any) {
//   const [camEnabled, setCamEnabled] = useState(userData.cameraEnabled); const [name, setName] = useState(userData.name); const [image, setImage] = useState(userData.profileImage);
//   const pickImage = async () => { let result = await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Images,allowsEditing:true,aspect:[1,1],quality:0.5}); if(!result.canceled) setImage(result.assets[0].uri); };
//   return (
//     <View style={styles.screenContainer}>
//       <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue}/></TouchableOpacity><Text style={styles.headerTitle}>SYSTEM SETTINGS</Text><View style={{width:24}}/></View>
//       <ScrollView style={{padding:20}} showsVerticalScrollIndicator={false}>
//         <View style={{alignItems:'center',marginBottom:20}}>
//           <TouchableOpacity onPress={pickImage}><Image source={image?{uri:image}:{uri:'https://via.placeholder.com/150'}} style={styles.settingsAvatar}/><View style={styles.editIconBadge}><Ionicons name="camera" size={14} color={COLORS.white}/></View></TouchableOpacity>
//           <Text style={[styles.label,{marginTop:10}]}>EDIT HUNTER NAME</Text><TextInput style={[styles.input,{textAlign:'center',width:'80%'}]} value={name} onChangeText={setName} placeholder="Hunter Name" placeholderTextColor={COLORS.textDark}/>
//         </View>
//         <View style={styles.divider}/>
//         <View style={styles.settingRow}><Text style={styles.settingText}>Enable Pose Detection (Camera)</Text><TouchableOpacity onPress={()=>setCamEnabled(!camEnabled)}><Ionicons name={camEnabled?"checkbox":"square-outline"} size={28} color={COLORS.blue}/></TouchableOpacity></View>
//         <TouchableOpacity style={styles.settingsSaveBtn} onPress={() => onSave({...userData,cameraEnabled:camEnabled,name,profileImage:image})}><Text style={styles.settingsSaveBtnText}>SAVE CHANGES</Text></TouchableOpacity>
//       </ScrollView>
//     </View>
//   );
// }

// const styles = StyleSheet.create({
//   expandBtn: { marginTop:10, alignItems:'center', paddingVertical:8, borderWidth:1, borderColor:COLORS.blue, borderRadius:6, borderStyle:'dashed' },
//   expandBtnText: { color:COLORS.blue, fontSize:11, fontWeight:'bold', letterSpacing:1.5 },
//   container: { flex:1, backgroundColor:COLORS.primary },
//   screenContainer: { flex:1, backgroundColor:COLORS.primary },
//   centerContainer: { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:COLORS.primary },
//   loadingTitle: { fontSize:32, fontWeight:'900', color:COLORS.blue, letterSpacing:4 },
//   loadingSubtitle: { color:COLORS.textDark, marginTop:10, letterSpacing:2 },
//   header: { flexDirection:'row', justifyContent:'space-between', padding:20, alignItems:'center', borderBottomWidth:1, borderBottomColor:COLORS.accent },
//   headerTitle: { color:COLORS.text, fontSize:18, fontWeight:'bold', letterSpacing:1.5 },
//   // Big workout timer banner in training
//   workoutTimerBanner: { flexDirection:'row', alignItems:'center', justifyContent:'center', paddingVertical:12, backgroundColor:COLORS.secondary, borderBottomWidth:1, borderBottomColor:COLORS.gold },
//   workoutTimerText: { color:COLORS.gold, fontSize:36, fontWeight:'900', letterSpacing:4, marginLeft:8 },
//   timerBadge: { flexDirection:'row', alignItems:'center', backgroundColor:COLORS.secondary, paddingVertical:4, paddingHorizontal:10, borderRadius:12, borderWidth:1, borderColor:COLORS.gold },
//   timerValue: { color:COLORS.gold, fontWeight:'bold', marginLeft:5, fontSize:12 },
//   avatarPicker: { alignSelf:'center', marginVertical:20 },
//   avatarPlaceholder: { width:100, height:100, borderRadius:50, backgroundColor:COLORS.accent, justifyContent:'center', alignItems:'center', borderStyle:'dashed', borderWidth:1, borderColor:COLORS.textDark },
//   avatarImage: { width:100, height:100, borderRadius:50 },
//   avatarText: { fontSize:10, color:COLORS.textDark, marginTop:5 },
//   formGroup: { marginBottom:15 },
//   row: { flexDirection:'row', justifyContent:'space-between' },
//   label: { color:COLORS.blue, fontSize:12, marginBottom:5, fontWeight:'bold' },
//   input: { backgroundColor:COLORS.secondary, color:COLORS.text, padding:15, borderRadius:8, borderWidth:1, borderColor:COLORS.accent },
//   genderContainer: { flexDirection:'row', justifyContent:'space-between' },
//   genderBtn: { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', padding:15, backgroundColor:COLORS.secondary, borderRadius:8, borderWidth:1, borderColor:COLORS.accent, marginHorizontal:5 },
//   genderBtnActive: { backgroundColor:COLORS.blue, borderColor:COLORS.glow },
//   genderText: { color:COLORS.blue, fontWeight:'bold', marginLeft:8 },
//   genderTextActive: { color:COLORS.white, fontWeight:'bold', marginLeft:8 },
//   goalBtn: { flexDirection:'row', alignItems:'center', padding:15, backgroundColor:COLORS.secondary, borderRadius:8, borderWidth:1, borderColor:COLORS.accent, marginBottom:8 },
//   goalBtnActive: { backgroundColor:COLORS.blue, borderColor:COLORS.glow },
//   goalText: { color:COLORS.blue, fontWeight:'bold', marginLeft:15 },
//   goalTextActive: { color:COLORS.white, fontWeight:'bold', marginLeft:15 },
//   mainButton: { backgroundColor:COLORS.blue, padding:18, borderRadius:8, alignItems:'center', marginTop:20 },
//   mainButtonText: { color:COLORS.primary, fontWeight:'bold', fontSize:16, letterSpacing:2 },
//   dashboardHeader: { padding:20, paddingTop:10 },
//   profileRow: { flexDirection:'row', alignItems:'center' },
//   profileImageSmall: { width:60, height:60, borderRadius:30, marginRight:15, borderWidth:2, borderColor:COLORS.blue },
//   playerName: { color:COLORS.text, fontSize:22, fontWeight:'bold' },
//   playerRank: { color:COLORS.glow, fontSize:12, letterSpacing:1 },
//   systemWindow: { margin:20, padding:20, backgroundColor:COLORS.secondary, borderRadius:12, borderWidth:1, borderColor:COLORS.blue },
//   systemHeader: { color:COLORS.text, textAlign:'center', fontWeight:'bold', marginBottom:15 },
//   xpBarContainer: { height:6, backgroundColor:COLORS.accent, borderRadius:3, marginBottom:5 },
//   xpBarFill: { height:'100%', backgroundColor:COLORS.blue, borderRadius:3 },
//   xpText: { color:COLORS.textDark, fontSize:10, textAlign:'right', marginBottom:15 },
//   statGrid: { flexDirection:'row', justifyContent:'space-around' },
//   statItem: { alignItems:'center' },
//   statVal: { color:COLORS.text, fontSize:18, fontWeight:'bold' },
//   statLbl: { color:COLORS.textDark, fontSize:10 },
//   menuGrid: { padding:20 },
//   menuCardLarge: { backgroundColor:COLORS.accent, padding:20, borderRadius:12, alignItems:'center', marginBottom:15, borderWidth:1, borderColor:COLORS.gold },
//   menuTitle: { color:COLORS.text, fontSize:18, fontWeight:'bold', marginTop:10 },
//   menuSub: { color:COLORS.danger, fontSize:12 },
//   menuRow: { flexDirection:'row', justifyContent:'space-between', marginBottom:15 },
//   menuCardSmall: { backgroundColor:COLORS.secondary, width:'48%', padding:15, borderRadius:12, alignItems:'center', borderWidth:1, borderColor:COLORS.accent },
//   menuTitleSmall: { color:COLORS.text, marginTop:5, fontSize:12 },
//   playerMain: { alignItems:'center', padding:20 },
//   albumArtPlaceholder: { width:140, height:140, backgroundColor:COLORS.secondary, borderRadius:12, justifyContent:'center', alignItems:'center', marginBottom:15, borderWidth:1, borderColor:COLORS.accent },
//   albumArt: { width:140, height:140, borderRadius:12, marginBottom:15, borderWidth:1, borderColor:COLORS.accent },
//   nowPlayingTitle: { color:COLORS.text, fontSize:18, fontWeight:'bold', marginBottom:10, textAlign:'center' },
//   seekContainer: { flexDirection:'row', alignItems:'center', width:'100%', marginBottom:15 },
//   timeText: { color:COLORS.textDark, fontSize:10, width:35, textAlign:'center' },
//   playerControlsMain: { flexDirection:'row', alignItems:'center', justifyContent:'space-around', width:'80%' },
//   playButtonLarge: { width:60, height:60, borderRadius:30, backgroundColor:COLORS.blue, justifyContent:'center', alignItems:'center' },
//   ctrlBtn: { padding:10 },
//   modeBtnHeader: { flexDirection:'row', alignItems:'center', backgroundColor:COLORS.secondary, padding:5, borderRadius:5, borderWidth:1, borderColor:COLORS.accent },
//   playlistHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal:20, marginTop:10 },
//   sectionTitle: { color:COLORS.blue, fontWeight:'bold' },
//   addBtn: { backgroundColor:COLORS.highlight, padding:5, borderRadius:4 },
//   searchContainer: { flexDirection:'row', alignItems:'center', backgroundColor:COLORS.secondary, borderRadius:8, paddingHorizontal:10, paddingVertical:5, borderWidth:1, borderColor:COLORS.accent, marginTop:10 },
//   searchInput: { flex:1, color:COLORS.text, marginLeft:10, paddingVertical:5 },
//   playlistContainer: { padding:20 },
//   trackRow: { flexDirection:'row', alignItems:'center', paddingVertical:12, borderBottomWidth:1, borderBottomColor:COLORS.accent, justifyContent:'space-between' },
//   trackActive: { backgroundColor:COLORS.accent },
//   trackInfoArea: { flexDirection:'row', alignItems:'center', flex:1 },
//   trackIcon: { width:30 },
//   trackName: { color:COLORS.textDark, flex:1, fontSize:14, marginLeft:5 },
//   trackNameActive: { color:COLORS.white, fontWeight:'bold', textShadowColor:COLORS.glow, textShadowRadius:8 },
//   deleteBtn: { padding:5 },
//   miniPlayerContainer: { position:'relative', bottom:0, left:0, right:0, height:70, backgroundColor:COLORS.secondary, borderTopWidth:1, borderTopColor:COLORS.blue, zIndex:999 },
//   miniProgressContainer: { height:2, backgroundColor:COLORS.accent, width:'100%' },
//   miniProgressFill: { height:'100%', backgroundColor:COLORS.highlight },
//   miniPlayerContent: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:15, flex:1 },
//   miniInfo: { flexDirection:'row', alignItems:'center', flex:1, paddingRight:10 },
//   miniArt: { width:40, height:40, borderRadius:4, marginRight:10 },
//   miniTitle: { color:COLORS.white, fontWeight:'bold', fontSize:14 },
//   miniTime: { color:COLORS.textDark, fontSize:10 },
//   miniControls: { flexDirection:'row', alignItems:'center' },
//   miniCtrlBtn: { marginHorizontal:8 },
//   cameraContainer: { height:250, backgroundColor:'#000', overflow:'hidden' },
//   camera: { flex:1 },
//   cameraOverlay: { flex:1, justifyContent:'center', alignItems:'center' },
//   detectionText: { color:COLORS.success, fontSize:10, position:'absolute', top:10, right:10, backgroundColor:'rgba(0,0,0,0.5)', padding:4 },
//   poseBox: { width:200, height:300, borderWidth:2, borderColor:COLORS.glow, opacity:0.5 },
//   camWarningBox: { backgroundColor:'rgba(239,68,68,0.8)', padding:10, borderRadius:5 },
//   camWarningText: { color:COLORS.white, fontWeight:'bold' },
//   poseInfoBox: { position:'absolute', bottom:10, left:10, right:10, backgroundColor:'rgba(0,0,0,0.6)', padding:10, borderRadius:5 },
//   poseInfoText: { color:COLORS.success, fontWeight:'bold', fontSize:12 },
//   poseInfoSub: { color:COLORS.textDark, fontSize:10 },
//   cameraOff: { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:COLORS.secondary },
//   cameraOffText: { color:COLORS.text, fontWeight:'bold', marginTop:10 },
//   cameraOffSub: { color:COLORS.textDark, fontSize:10 },
//   exerciseList: { flex:1, padding:20 },
//   exerciseCard: { backgroundColor:COLORS.secondary, padding:15, marginBottom:10, borderRadius:8, borderWidth:1, borderColor:COLORS.accent },
//   exerciseCardActive: { borderColor:COLORS.blue, backgroundColor:'#1e293b' },
//   exerciseCardDone: { opacity:0.6, borderColor:COLORS.success },
//   exHeaderRow: { flexDirection:'row', alignItems:'center', marginBottom:10 },
//   exIcon: { width:40 },
//   exName: { color:COLORS.text, fontWeight:'bold', marginBottom:5 },
//   progressBarBg: { height:4, backgroundColor:COLORS.accent, borderRadius:2, width:'90%' },
//   progressBarFill: { height:'100%', backgroundColor:COLORS.blue, borderRadius:2 },
//   countTextLarge: { color:COLORS.white, fontSize:16, fontWeight:'bold' },
//   seriesControls: { flexDirection:'row', alignItems:'center', marginTop:5, justifyContent:'flex-end' },
//   seriesInput: { width:50, height:35, backgroundColor:COLORS.primary, color:COLORS.white, textAlign:'center', borderRadius:4, borderWidth:1, borderColor:COLORS.accent, marginHorizontal:5 },
//   seriesBtn: { backgroundColor:COLORS.blue, paddingHorizontal:10, paddingVertical:8, borderRadius:4, marginHorizontal:5 },
//   seriesBtnSmall: { backgroundColor:COLORS.accent, width:35, height:35, borderRadius:4, alignItems:'center', justifyContent:'center' },
//   seriesBtnText: { color:COLORS.white, fontSize:10, fontWeight:'bold' },
//   checkBtn: { width:35, height:35, borderRadius:17.5, borderWidth:1, borderColor:COLORS.textDark, alignItems:'center', justifyContent:'center', marginLeft:10 },
//   checkBtnDone: { backgroundColor:COLORS.success, borderColor:COLORS.success },
//   checkAllBtn: { marginVertical:10, padding:10, borderWidth:1, borderColor:COLORS.blue, borderRadius:8, alignItems:'center' },
//   checkAllText: { color:COLORS.blue, fontSize:12, fontWeight:'bold', letterSpacing:1 },
//   completeBtn: { backgroundColor:COLORS.blue, margin:20, padding:15, borderRadius:8, alignItems:'center' },
//   completeBtnText: { color:COLORS.primary, fontWeight:'bold', letterSpacing:2 },
//   programCard: { backgroundColor:COLORS.secondary, padding:15, borderRadius:8, marginBottom:15, flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
//   progTitle: { color:COLORS.text, fontSize:16, fontWeight:'bold' },
//   progSub: { color:COLORS.textDark, fontSize:12 },
//   startBtnSmall: { backgroundColor:COLORS.success, paddingHorizontal:12, paddingVertical:6, borderRadius:4, marginRight:10 },
//   editProgBtn: { backgroundColor:COLORS.accent, paddingHorizontal:8, paddingVertical:6, borderRadius:4, marginRight:10 },
//   deleteProgBtn: { padding:5 },
//   btnTextSmall: { color:COLORS.primary, fontWeight:'bold', fontSize:10 },
//   modalOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.8)', justifyContent:'center', padding:20 },
//   createModal: { backgroundColor:COLORS.secondary, padding:20, borderRadius:12, borderWidth:1, borderColor:COLORS.blue },
//   modalTitle: { color:COLORS.text, fontSize:18, fontWeight:'bold', textAlign:'center', marginBottom:15 },
//   selectRowContainer: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:10, borderBottomWidth:1, borderBottomColor:COLORS.accent },
//   rowLabel: { color:COLORS.textDark, fontSize:16 },
//   repsInput: { backgroundColor:COLORS.primary, color:COLORS.white, width:50, padding:5, borderRadius:4, textAlign:'center', borderWidth:1, borderColor:COLORS.blue, marginRight:10 },
//   checkboxBtn: { padding:5, borderRadius:4, borderWidth:1, borderColor:COLORS.blue },
//   checkboxActive: { backgroundColor:COLORS.danger, borderColor:COLORS.danger },
//   addCustomBtn: { backgroundColor:COLORS.blue, padding:10, borderRadius:4, justifyContent:'center', alignItems:'center' },
//   cancelBtn: { flex:1, padding:15, alignItems:'center', marginRight:10 },
//   saveBtn: { flex:1, backgroundColor:COLORS.blue, padding:15, alignItems:'center', borderRadius:6 },
//   btnText: { color:COLORS.text, fontWeight:'bold' },
//   settingsSaveBtn: { backgroundColor:COLORS.blue, padding:18, borderRadius:8, alignItems:'center', marginTop:30 },
//   settingsSaveBtnText: { color:COLORS.white, fontWeight:'bold', fontSize:16, letterSpacing:1 },
//   settingsAvatar: { width:120, height:120, borderRadius:60, borderWidth:2, borderColor:COLORS.blue, marginBottom:10 },
//   editIconBadge: { position:'absolute', bottom:10, right:10, backgroundColor:COLORS.blue, width:30, height:30, borderRadius:15, justifyContent:'center', alignItems:'center', borderWidth:2, borderColor:COLORS.secondary },
//   statBoxLarge: { backgroundColor:COLORS.accent, padding:20, alignItems:'center', borderRadius:12, marginTop:20 },
//   bigStat: { color:COLORS.blue, fontSize:40, fontWeight:'bold' },
//   bigStatLbl: { color:COLORS.textDark, fontSize:12, letterSpacing:2 },
//   questPaperDark: { backgroundColor:COLORS.secondary, margin:20, padding:20, borderRadius:8, borderWidth:1, borderColor:COLORS.accent },
//   questTitleDark: { color:COLORS.text, fontSize:20, fontWeight:'bold', textAlign:'center' },
//   difficulty: { color:COLORS.gold, textAlign:'center', fontSize:12, marginBottom:10 },
//   objTitleDark: { color:COLORS.blue, fontWeight:'bold', marginTop:10 },
//   objRow: { flexDirection:'row', justifyContent:'space-between', marginTop:5 },
//   objTextDark: { color:COLORS.text },
//   objValDark: { color:COLORS.text, fontWeight:'bold' },
//   divider: { height:1, backgroundColor:COLORS.accent, marginVertical:10 },
//   rewardTitleDark: { color:COLORS.text, fontWeight:'bold' },
//   rewardText: { color:COLORS.blue, fontWeight:'bold' },
//   acceptBtn: { backgroundColor:COLORS.blue, margin:20, padding:15, borderRadius:8, alignItems:'center' },
//   acceptBtnText: { color:COLORS.primary, fontWeight:'bold', letterSpacing:2 },
//   settingRow: { flexDirection:'row', justifyContent:'space-between', paddingVertical:15, borderBottomWidth:1, borderBottomColor:COLORS.accent, alignItems:'center' },
//   settingText: { color:COLORS.text, fontSize:16 },
//   alertBox: { backgroundColor:COLORS.secondary, borderRadius:12, borderWidth:2, borderColor:COLORS.blue, padding:20, width:'100%' },
//   alertTitle: { color:COLORS.blue, fontSize:18, fontWeight:'bold', textAlign:'center', letterSpacing:1 },
//   alertMessage: { color:COLORS.text, textAlign:'center', marginVertical:15 },
//   alertButtons: { flexDirection:'row', justifyContent:'center', marginTop:10 },
//   alertButton: { paddingHorizontal:20, paddingVertical:10, borderRadius:6, minWidth:80, alignItems:'center', marginHorizontal:5 },
//   alertButtonDefault: { backgroundColor:COLORS.blue },
//   alertButtonDestructive: { backgroundColor:COLORS.danger },
//   alertButtonCancel: { backgroundColor:COLORS.accent },
//   alertButtonText: { color:COLORS.text, fontWeight:'bold', fontSize:12 },
//   timerCircle: { width:120, height:120, borderRadius:60, borderWidth:4, borderColor:COLORS.blue, justifyContent:'center', alignItems:'center', marginVertical:30 },
//   timerText: { fontSize:40, fontWeight:'bold', color:COLORS.white },
//   dayBtn: { width:35, height:35, borderRadius:17.5, backgroundColor:COLORS.secondary, justifyContent:'center', alignItems:'center', borderWidth:1, borderColor:COLORS.accent },
//   dayBtnActive: { backgroundColor:COLORS.blue, borderColor:COLORS.glow },
//   dayBtnText: { color:COLORS.textDark, fontSize:12, fontWeight:'bold' },
//   // Timer screen controls
//   timerCtrlBtn: { flexDirection:'row', alignItems:'center', paddingHorizontal:20, paddingVertical:10, borderRadius:8, marginHorizontal:5 },
//   timerCtrlText: { color:COLORS.white, fontWeight:'bold', marginLeft:6, fontSize:13, letterSpacing:1 },
// });














// import {
//   FontAwesome5,
//   Ionicons,
//   MaterialCommunityIcons,
// } from "@expo/vector-icons";
// import AsyncStorage from "@react-native-async-storage/async-storage";
// import Slider from "@react-native-community/slider";
// import { Audio } from "expo-av";
// import { CameraView, useCameraPermissions } from "expo-camera";
// import * as DocumentPicker from "expo-document-picker";
// import * as ImagePicker from "expo-image-picker";
// import React, { useEffect, useRef, useState } from "react";
// import {
//   Animated,
//   BackHandler,
//   Dimensions,
//   Image,
//   Modal,
//   ScrollView,
//   StatusBar,
//   StyleSheet,
//   Text,
//   TextInput,
//   TouchableOpacity,
//   Vibration,
//   View
// } from "react-native";
// import { LineChart } from "react-native-chart-kit";
// import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

// const { width } = Dimensions.get('window');

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
//   xpGained: number; // Can be negative for penalties
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

//   // Music Player State
//   const [playlist, setPlaylist] = useState<MusicTrack[]>([]);
//   const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
//   const [sound, setSound] = useState<Audio.Sound | null>(null); 
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
//       // Ducking music volume manually if needed
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
//       // 1. Stop system sound if it's interfering
//       if (systemSoundObj) {
//         try {
//             systemSoundObj.stopAsync();
//             systemSoundObj.unloadAsync();
//             setSystemSoundObj(null);
//         } catch (e) {
//             console.log("Error stopping system sound on back press", e);
//         }
//       }

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
//   }, [screen, systemSoundObj]);

//   // --- Initialization & Penalty System ---
//   useEffect(() => {
//     async function init() {
//       // 1. Configure Background Audio 
//       try {
//         await Audio.setAudioModeAsync({
//           allowsRecordingIOS: false,
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
    
//     // If last completed was today, no penalty
//     if (user.lastDailyQuestCompleted === todayStr) return user;

//     let penaltyXP = 0;
//     let missedDays = 0;
    
//     // Check from the day after last completed, up to yesterday
//     const checkDate = new Date(lastDate);
//     checkDate.setDate(checkDate.getDate() + 1);

//     // Get History to append negative values
//     const historyData = await AsyncStorage.getItem('trainingHistory');
//     const history: TrainingHistory[] = historyData ? JSON.parse(historyData) : [];
//     let historyChanged = false;

//     // Loop until we reach today (exclusive of today)
//     while (getISODate(checkDate) < todayStr) {
//         // Penalty is equal to what the user WOULD have gained from a daily quest
//         // Standard formula: Level * 100
//         const dailyPenaltyAmount = user.level * 100;

//         penaltyXP += dailyPenaltyAmount;
//         missedDays++;

//         // Log negative XP to history for the chart
//         history.push({
//           date: checkDate.toISOString(),
//           quest: {
//             title: "PENALTY: MISSED QUEST",
//             difficulty: 0,
//             exercises: {},
//             rewards: { xp: 0, title: 'None' }
//           },
//           results: {},
//           xpGained: -dailyPenaltyAmount, // Negative value for the chart
//           durationSeconds: 0
//         });
//         historyChanged = true;

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

//         // Update lastDailyQuestCompleted to Yesterday. 
//         // This ensures we don't penalize these days again if the app is reopened today.
//         const yesterday = new Date();
//         yesterday.setDate(yesterday.getDate() - 1);
//         user.lastDailyQuestCompleted = getISODate(yesterday);

//         showAlert(
//           "PENALTY SYSTEM", 
//           `You failed to complete daily quests for ${missedDays} day(s).\n\nPUNISHMENT: -${penaltyXP} XP.\n${user.level < (JSON.parse(await AsyncStorage.getItem('userData') || '{}').level || user.level) ? 'YOUR LEVEL HAS DECREASED.' : ''}`
//         );
        
//         await AsyncStorage.setItem('userData', JSON.stringify(user));
        
//         if (historyChanged) {
//            await AsyncStorage.setItem('trainingHistory', JSON.stringify(history));
//         }
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
//   // const xpPercent = (userData.xp / (userData.level * XP_PER_LEVEL_BASE)) * 100;
//   const xpPercent = (Math.max(0, userData.xp) / (userData.level * XP_PER_LEVEL_BASE)) * 100;
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
//       <ScrollView 
//         style={styles.playlistContainer} 
//         contentContainerStyle={{ paddingBottom: 20 }} // Fix for list overflow
//         showsVerticalScrollIndicator={false}
//       >
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
//             // Group by date (YYYY-MM-DD) and sum XP (Gains + Penalties)
//             const grouped: {[key: string]: number} = {};
//             history.forEach((entry: TrainingHistory) => {
//                 const dateKey = entry.date.split('T')[0];
//                 // xpGained can be negative (penalty) or positive (reward)
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
//             style: { borderRadius: 16 }, propsForDots: { r: "6", strokeWidth: "2", stroke: COLORS.glow },
//           }}
//           style={{ marginVertical: 8, borderRadius: 16 }}
//           bezier // Optional: makes the line curved
//         />
//         <View style={styles.statBoxLarge}><Text style={styles.bigStat}>{userData.totalWorkouts}</Text><Text style={styles.bigStatLbl}>TOTAL DUNGEONS CLEARED</Text></View>
//       </View>
//     </ScrollView>
//   );
// }

// // function QuestScreen({ userData, customPrograms, onBack, onStartTraining }: any) {
// //    // Generate Quest based on Goal and Level AND Schedule
// //    const getDailyQuest = (): Quest => {
// //       const todayDay = getDayString(new Date());
      
// //       // 1. Check for Scheduled Custom Program
// //       const scheduledProg = customPrograms.find((p: CustomProgram) => p.schedule && p.schedule.includes(todayDay));
// //       if (scheduledProg) {
// //           // Calculate XP based on level scaling roughly (standard reward for daily)
// //           return {
// //               title: `DAILY: ${scheduledProg.name.toUpperCase()}`,
// //               difficulty: Math.floor(userData.level / 5) + 1,
// //               exercises: scheduledProg.exercises,
// //               customExercises: scheduledProg.customExercises,
// //               rewards: { xp: userData.level * 100, title: 'Hunter' }, // High reward for scheduled custom
// //               isDaily: true
// //           };
// //       }

// //       // 2. Fallback to Standard Logic
// //       const level = userData.level;
// //       let exercises: {[key:string]: number} = {};
// //       let title = "DAILY QUEST";
// //       let rewardXP = level * 100; // Base reward

// //       if (userData.goal === 'speed_strength') {
// //           title = "ASSASSIN TRAINING";
// //           exercises = { clapPushups: Math.ceil(level * 5), jumpSquats: Math.ceil(level * 10), situps: Math.ceil(level * 10), running: Math.min(1 + (level * 0.2), 5) };
// //       } else if (userData.goal === 'weight_loss') {
// //           title = "ENDURANCE TRIAL";
// //           exercises = { squats: level * 15, situps: level * 15, burpees: level * 5, running: Math.min(2 + (level * 0.5), 10) };
// //       } else {
// //           title = "STRENGTH TRAINING";
// //           exercises = { pushups: level * 10, squats: level * 10, situps: level * 10, pullups: Math.ceil(level * 2) };
// //       }

// //       return { title, difficulty: Math.floor(level / 5) + 1, exercises, rewards: { xp: rewardXP, title: 'Hunter' }, isDaily: true };
// //    };

// //    const dailyQuest = getDailyQuest();
// //    const insets = useSafeAreaInsets();
// //    return (
// //       <View style={[styles.screenContainer, { paddingBottom: insets.bottom }]}>
// //          <View style={styles.header}><TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={24} color={COLORS.blue} /></TouchableOpacity><Text style={styles.headerTitle}>QUEST INFO</Text><View style={{width: 24}} /></View>
// //          <View style={styles.questPaperDark}>
// //             <Text style={styles.questTitleDark}>{dailyQuest.title}</Text>
// //             <Text style={styles.difficulty}>Rank: {'★'.repeat(dailyQuest.difficulty)}</Text>
// //             <View style={styles.divider} />
// //             <Text style={styles.objTitleDark}>OBJECTIVES:</Text>
// //             {Object.entries(dailyQuest.exercises).map(([k, v]) => (
// //                <View key={k} style={styles.objRow}>
// //                   <View style={{flexDirection: 'row', alignItems: 'center'}}>
// //                      <View style={{width: 6, height: 6, backgroundColor: COLORS.blue, marginRight: 8}} />
// //                      <Text style={styles.objTextDark}>{(dailyQuest.customExercises?.[k]?.name) || EXERCISES[k]?.name || k}</Text>
// //                   </View>
// //                   <Text style={styles.objValDark}>{v} {EXERCISES[k]?.type === 'distance' ? 'km' : ''}</Text>
// //                </View>
// //             ))}
// //             <View style={styles.divider} />
// //             <Text style={styles.rewardTitleDark}>REWARDS:</Text>
// //             <Text style={styles.rewardText}>+ {dailyQuest.rewards.xp} XP</Text>
// //          </View>
// //          <TouchableOpacity style={[styles.acceptBtn, userData.lastDailyQuestCompleted === getISODate(new Date()) ? {backgroundColor: COLORS.textDark} : {}]} disabled={userData.lastDailyQuestCompleted === getISODate(new Date())} onPress={() => onStartTraining(dailyQuest)}>
// //             <Text style={styles.acceptBtnText}>{userData.lastDailyQuestCompleted === getISODate(new Date()) ? 'QUEST COMPLETE' : 'ACCEPT QUEST'}</Text>
// //          </TouchableOpacity>
// //       </View>
// //    );
// // }

// // function QuestScreen({ userData, customPrograms, onBack, onStartTraining }: any) {
// //    const getDailyQuest = (): Quest => {
// //       const todayDay = getDayString(new Date());
// //       const scheduledProg = customPrograms.find((p: CustomProgram) => p.schedule && p.schedule.includes(todayDay));
// //       if (scheduledProg) {
// //           return {
// //               title: `DAILY: ${scheduledProg.name.toUpperCase()}`,
// //               difficulty: Math.floor(userData.level / 5) + 1,
// //               exercises: scheduledProg.exercises,
// //               customExercises: scheduledProg.customExercises,
// //               rewards: { xp: userData.level * 100, title: 'Hunter' },
// //               isDaily: true
// //           };
// //       }
// //       const level = userData.level;
// //       let exercises: {[key:string]: number} = {};
// //       let title = "DAILY QUEST";
// //       let rewardXP = level * 100;
// //       if (userData.goal === 'speed_strength') {
// //           title = "ASSASSIN TRAINING";
// //           exercises = { clapPushups: Math.ceil(level * 5), jumpSquats: Math.ceil(level * 10), situps: Math.ceil(level * 10), running: Math.min(1 + (level * 0.2), 5) };
// //       } else if (userData.goal === 'weight_loss') {
// //           title = "ENDURANCE TRIAL";
// //           exercises = { squats: level * 15, situps: level * 15, burpees: level * 5, running: Math.min(2 + (level * 0.5), 10) };
// //       } else {
// //           title = "STRENGTH TRAINING";
// //           exercises = { pushups: level * 10, squats: level * 10, situps: level * 10, pullups: Math.ceil(level * 2) };
// //       }
// //       return { title, difficulty: Math.floor(level / 5) + 1, exercises, rewards: { xp: rewardXP, title: 'Hunter' }, isDaily: true };
// //    };

// //    const dailyQuest = getDailyQuest();
// //    const insets = useSafeAreaInsets();
// //    const PREVIEW_COUNT = 3;
// //    const [expanded, setExpanded] = useState(false);

// //    const exerciseEntries = Object.entries(dailyQuest.exercises);
// //    const hasMore = exerciseEntries.length > PREVIEW_COUNT;
// //    const visibleExercises = expanded ? exerciseEntries : exerciseEntries.slice(0, PREVIEW_COUNT);
// //    const isCompleted = userData.lastDailyQuestCompleted === getISODate(new Date());

// //    return (
// //       <View style={styles.screenContainer}>
// //          {/* Header */}
// //          <View style={styles.header}>
// //             <TouchableOpacity onPress={onBack}>
// //                <Ionicons name="arrow-back" size={24} color={COLORS.blue} />
// //             </TouchableOpacity>
// //             <Text style={styles.headerTitle}>QUEST INFO</Text>
// //             <View style={{width: 24}} />
// //          </View>

// //          {/* Scrollable content */}
// //          <ScrollView
// //             style={{ flex: 1 }}
// //             contentContainerStyle={{ padding: 20, paddingBottom: 10 }}
// //             showsVerticalScrollIndicator={false}
// //          >
// //             <View style={styles.questPaperDark}>
// //                <Text style={styles.questTitleDark}>{dailyQuest.title}</Text>
// //                <Text style={styles.difficulty}>Rank: {'★'.repeat(dailyQuest.difficulty)}</Text>
// //                <View style={styles.divider} />

// //                <Text style={styles.objTitleDark}>OBJECTIVES:</Text>

// //                {visibleExercises.map(([k, v]) => (
// //                   <View key={k} style={styles.objRow}>
// //                      <View style={{flexDirection: 'row', alignItems: 'center'}}>
// //                         <View style={{width: 6, height: 6, backgroundColor: COLORS.blue, marginRight: 8}} />
// //                         <Text style={styles.objTextDark}>
// //                            {(dailyQuest.customExercises?.[k]?.name) || EXERCISES[k]?.name || k}
// //                         </Text>
// //                      </View>
// //                      <Text style={styles.objValDark}>
// //                         {String(v)}{EXERCISES[k]?.type === 'distance' ? ' km' : ''}
// //                      </Text>
// //                   </View>
// //                ))}

// //                {/* Expand / Collapse */}
// //                {hasMore && (
// //                   <TouchableOpacity
// //                      onPress={() => setExpanded(!expanded)}
// //                      style={styles.expandBtn}
// //                   >
// //                      <Text style={styles.expandBtnText}>
// //                         {expanded
// //                            ? '▲  SHOW LESS'
// //                            : `▼  +${exerciseEntries.length - PREVIEW_COUNT} MORE OBJECTIVES`}
// //                      </Text>
// //                   </TouchableOpacity>
// //                )}

// //                <View style={styles.divider} />
// //                <Text style={styles.rewardTitleDark}>REWARDS:</Text>
// //                <Text style={styles.rewardText}>+ {dailyQuest.rewards.xp} XP</Text>
// //             </View>
// //          </ScrollView>

// //          {/* Fixed bottom button — sits exactly above nav/safe area */}
// //          <View style={{
// //             paddingHorizontal: 20,
// //             paddingBottom: insets.bottom + 1,
// //             paddingTop: 10,
// //             borderTopWidth: 1,
// //             borderTopColor: COLORS.accent,
// //             backgroundColor: COLORS.primary,
// //          }}>
// //             <TouchableOpacity
// //                style={[styles.acceptBtn, { marginBottom: 0 }, isCompleted && { backgroundColor: COLORS.textDark }]}
// //                disabled={isCompleted}
// //                onPress={() => onStartTraining(dailyQuest)}
// //             >
// //                <Text style={styles.acceptBtnText}>
// //                   {isCompleted ? 'QUEST COMPLETE' : 'ACCEPT QUEST'}
// //                </Text>
// //             </TouchableOpacity>
// //          </View>
// //       </View>
// //    );
// // }
// function QuestScreen({ userData, customPrograms, onBack, onStartTraining }: any) {
//    const getDailyQuest = (): Quest => {
//       const todayDay = getDayString(new Date());
//       const scheduledProg = customPrograms.find((p: CustomProgram) => p.schedule && p.schedule.includes(todayDay));
//       if (scheduledProg) {
//           return {
//               title: `DAILY: ${scheduledProg.name.toUpperCase()}`,
//               difficulty: Math.floor(userData.level / 5) + 1,
//               exercises: scheduledProg.exercises,
//               customExercises: scheduledProg.customExercises,
//               rewards: { xp: userData.level * 100, title: 'Hunter' },
//               isDaily: true
//           };
//       }
//       const level = userData.level;
//       let exercises: {[key:string]: number} = {};
//       let title = "DAILY QUEST";
//       let rewardXP = level * 100;
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
//    const [expanded, setExpanded] = useState(false);

//    const MAX_PREVIEW = 14;
//    const exerciseEntries = Object.entries(dailyQuest.exercises);
//    const hasMore = exerciseEntries.length > MAX_PREVIEW;
//    const visibleExercises = expanded ? exerciseEntries : exerciseEntries.slice(0, MAX_PREVIEW);
//    const isCompleted = userData.lastDailyQuestCompleted === getISODate(new Date());

//    return (
//       <View style={styles.screenContainer}>

//          <View style={styles.header}>
//             <TouchableOpacity onPress={onBack}>
//                <Ionicons name="arrow-back" size={24} color={COLORS.blue} />
//             </TouchableOpacity>
//             <Text style={styles.headerTitle}>QUEST INFO</Text>
//             <View style={{width: 24}} />
//          </View>

//          <ScrollView
//             style={{ flex: 1 }}
//             contentContainerStyle={{ paddingBottom: 10 }}
//             showsVerticalScrollIndicator={false}
//          >
//             <View style={styles.questPaperDark}>
//                <Text style={styles.questTitleDark}>{dailyQuest.title}</Text>
//                <Text style={styles.difficulty}>Rank: {'★'.repeat(dailyQuest.difficulty)}</Text>
//                <View style={styles.divider} />

//                <Text style={styles.objTitleDark}>OBJECTIVES:</Text>

//                {visibleExercises.map(([k, v]) => (
//                   <View key={k} style={[styles.objRow, { marginTop: 5 }]}>
//                      <View style={{flexDirection: 'row', alignItems: 'center'}}>
//                         <View style={{width: 6, height: 6, backgroundColor: COLORS.blue, marginRight: 8}} />
//                         <Text style={styles.objTextDark}>
//                            {(dailyQuest.customExercises?.[k]?.name) || EXERCISES[k]?.name || k}
//                         </Text>
//                      </View>
//                      <Text style={styles.objValDark}>
//                         {String(v)}{EXERCISES[k]?.type === 'distance' ? ' km' : ''}
//                      </Text>
//                   </View>
//                ))}

//                {hasMore && (
//                   <TouchableOpacity
//                      onPress={() => setExpanded(!expanded)}
//                      style={styles.expandBtn}
//                   >
//                      <Text style={styles.expandBtnText}>
//                         {expanded
//                            ? '▲  SHOW LESS'
//                            : `▼  +${exerciseEntries.length - MAX_PREVIEW} MORE OBJECTIVES`}
//                      </Text>
//                   </TouchableOpacity>
//                )}

//                <View style={styles.divider} />
//                <Text style={styles.rewardTitleDark}>REWARDS:</Text>
//                <Text style={styles.rewardText}>+ {dailyQuest.rewards.xp} XP</Text>
//             </View>
//          </ScrollView>

//          <View style={{
//             paddingHorizontal: 20,
//             paddingTop: 10,
//             paddingBottom: 10,
//             borderTopWidth: 1,
//             borderTopColor: COLORS.accent,
//             backgroundColor: COLORS.primary,
//          }}>
//             {/* <TouchableOpacity
//                style={[
//                   styles.acceptBtn,
//                   { marginBottom: 0 },
//                   isCompleted && { backgroundColor: COLORS.textDark }
//                ]}
//                disabled={isCompleted}
//                onPress={() => onStartTraining(dailyQuest)}
//             >
//                <Text style={styles.acceptBtnText}>
//                   {isCompleted ? 'QUEST COMPLETE' : 'ACCEPT QUEST'}
//                </Text>
//             </TouchableOpacity> */}
//             <TouchableOpacity style={[styles.acceptBtn, { marginBottom: 0 }]} onPress={() => onStartTraining(dailyQuest)}>
//               <Text style={styles.acceptBtnText}>{isCompleted ? 'REPEAT QUEST (+XP)' : 'ACCEPT QUEST'}</Text>
//             </TouchableOpacity>
//          </View>

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
//   expandBtn: {
//     marginTop: 10,
//     alignItems: 'center',
//     paddingVertical: 8,
//     borderWidth: 1,
//     borderColor: COLORS.blue,
//     borderRadius: 6,
//     borderStyle: 'dashed',
//   },
//   expandBtnText: {
//     color: COLORS.blue,
//     fontSize: 11,
//     fontWeight: 'bold',
//     letterSpacing: 1.5,
//   },
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





// import {
//   FontAwesome5,
//   Ionicons,
//   MaterialCommunityIcons,
// } from "@expo/vector-icons";
// import AsyncStorage from "@react-native-async-storage/async-storage";
// import Slider from "@react-native-community/slider";
// import { Audio } from "expo-av";
// import { CameraView, useCameraPermissions } from "expo-camera";
// import * as DocumentPicker from "expo-document-picker";
// import * as ImagePicker from "expo-image-picker";
// import React, { useEffect, useRef, useState } from "react";
// import {
//   Animated,
//   BackHandler,
//   Image,
//   Modal,
//   ScrollView,
//   StatusBar,
//   StyleSheet,
//   Text,
//   TextInput,
//   TouchableOpacity,
//   Vibration,
//   View
// } from "react-native";
// import { LineChart } from "react-native-chart-kit";
// import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
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

//   // Music Player State
//   const [playlist, setPlaylist] = useState<MusicTrack[]>([]);
//   const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
//   const [sound, setSound] = useState<Audio.Sound | null>(null); 
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
//       // Ducking music volume manually if needed
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
//       // 1. Stop system sound if it's interfering
//       if (systemSoundObj) {
//         try {
//             systemSoundObj.stopAsync();
//             systemSoundObj.unloadAsync();
//             setSystemSoundObj(null);
//         } catch (e) {
//             console.log("Error stopping system sound on back press", e);
//         }
//       }

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
//   }, [screen, systemSoundObj]); // Added systemSoundObj dependency so closure captures it

//   // --- Initialization & Penalty System ---
//   useEffect(() => {
//     async function init() {
//       // 1. Configure Background Audio 
//       try {
//         await Audio.setAudioModeAsync({
//           allowsRecordingIOS: false,
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
//   // const xpPercent = (userData.xp / (userData.level * XP_PER_LEVEL_BASE)) * 100;
//   const xpPercent = (Math.max(0, userData.xp) / (userData.level * XP_PER_LEVEL_BASE)) * 100;
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
//       <ScrollView 
//         style={styles.playlistContainer} 
//         contentContainerStyle={{ paddingBottom: 20 }} // Fix for list overflow
//         showsVerticalScrollIndicator={false}
//       >
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






