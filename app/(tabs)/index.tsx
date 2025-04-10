import React, { useRef, useState, useCallback, useEffect } from "react";
import {
  StyleSheet,
  View,
  Button,
  ActivityIndicator,
  Alert,
  Platform,
  Text,
  TouchableOpacity,
} from "react-native";
import MapLibreGL, {
  MapView,
  OfflineManager,
  UserLocation,
  Camera,
} from "@maplibre/maplibre-react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";

// --- Set Access Token (If needed, ONCE at app startup) ---
// MapLibreGL.setAccessToken(null);
// --- ---

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// Define types (same as before for clarity)
type OfflinePackStatus = {
  state: number; // MapLibreGL.OfflinePackDownloadState
  percentage: number;
  // ... other status fields
};
type OfflinePackInfo = {
  name: string;
  metadata: any; // Usually the parsed JSON object
  // ... other pack fields
};
type OfflinePackError = {
  message: string;
};

export default function HomeScreen() {
  const mapRef = useRef<MapView>(null);
  const offlineManager = OfflineManager; // Still use the hook for the manager instance

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [showsUserLocation, setShowsUserLocation] = useState(false);
  const [locationPermission, setLocationPermission] = useState<boolean | null>(
    null
  );
  const [cameraConfig, setCameraConfig] = useState({
    followUserLocation: false,
    zoomLevel: 12,
    animationDuration: 0,
  });

  // Request location permission
  const requestLocationPermission = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      const isGranted = status === "granted";
      setLocationPermission(isGranted);

      if (!isGranted) {
        Alert.alert(
          "Permission Required",
          "Location permission is needed to show your position on the map.",
          [{ text: "OK" }]
        );
      }
      return isGranted;
    } catch (error) {
      console.error("Error requesting location permission:", error);
      setLocationPermission(false);
      return false;
    }
  }, []);

  // Check permission on component mount
  useEffect(() => {
    requestLocationPermission();
  }, [requestLocationPermission]);

  // --- Define Listeners ---
  const onProgress = useCallback(
    (pack: OfflinePackInfo, status: OfflinePackStatus) => {
      console.log(
        `[Progress Listener] Pack: ${pack.name}, State: ${
          status.state
        }, Progress: ${status.percentage?.toFixed(2)}%`
      );
      const progress = status.percentage / 100;
      setDownloadProgress(progress);

      if (status.state === 3) {
        console.log(`[Progress Listener] Download complete for ${pack.name}`);
        Alert.alert(
          "Download Complete",
          `Region "${
            pack.metadata?.name || pack.name
          }" downloaded successfully.`
        );
        setIsDownloading(false);
        setDownloadProgress(1);
      }
    },
    []
  );

  const onError = useCallback(
    (pack: OfflinePackInfo, err: OfflinePackError) => {
      console.error(
        `[Error Listener] Pack: ${pack.name}, Error: ${err.message}`
      );
      Alert.alert(
        "Download Error",
        `Failed to download region ${pack.name || "Unknown Pack"}. ${
          err.message
        }`
      );
      setIsDownloading(false);
      setDownloadProgress(0);
    },
    []
  );

  // --- Handle Download Action ---
  const handleDownload = useCallback(async () => {
    if (isDownloading || !offlineManager) {
      console.log(
        `Download prevented: isDownloading=${isDownloading}, offlineManager=${!!offlineManager}`
      );
      if (!offlineManager) {
        Alert.alert(
          "Error",
          "Offline manager is not yet available. Please wait and try again."
        );
      }
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      const bounds = await mapRef.current?.getVisibleBounds();
      const zoom = await mapRef.current?.getZoom();

      if (!bounds || zoom === undefined) {
        Alert.alert("Error", "Could not get map bounds or zoom level.");
        setIsDownloading(false);
        return;
      }

      const packName = `offline-pack-${Date.now()}`;
      const metadata = {
        name: `Region @ ${new Date().toLocaleTimeString()}`,
        downloaded_at: Date.now(),
      };

      const options = {
        name: packName,
        styleURL: MAP_STYLE_URL,
        bounds: bounds,
        minZoom: Math.max(0, Math.floor(zoom) - 2),
        maxZoom: Math.min(16, Math.floor(zoom) + 3),
        metadata: JSON.stringify(metadata),
      };

      console.log(
        "Calling createPack for:",
        packName,
        "with options:",
        options
      );

      await offlineManager.createPack(options, onProgress, onError);

      console.log(
        "Offline pack creation process initiated via createPack for:",
        packName
      );
    } catch (error: any) {
      console.error("Error calling createPack:", error);
      Alert.alert("Error", `Failed to start download. ${error.message}`);
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  }, [isDownloading, offlineManager, onProgress, onError]);

  // Focus on user location - update to check permissions first
  const handleLocationFocus = useCallback(async () => {
    if (locationPermission !== true) {
      const granted = await requestLocationPermission();
      if (!granted) return;
    }

    setShowsUserLocation(true);

    setCameraConfig({
      followUserLocation: true,
      zoomLevel: 15,
      animationDuration: 1000,
    });

    setTimeout(() => {
      setCameraConfig((prev) => ({
        ...prev,
        followUserLocation: false,
      }));
    }, 1500);
  }, [locationPermission, requestLocationPermission]);

  return (
    <View style={styles.container}>
      <MapView ref={mapRef} style={styles.map} mapStyle={MAP_STYLE_URL}>
        <Camera
          zoomLevel={cameraConfig.zoomLevel}
          animationDuration={cameraConfig.animationDuration}
          followUserLocation={cameraConfig.followUserLocation}
          followZoomLevel={15}
        />
        {showsUserLocation && locationPermission && <UserLocation />}
      </MapView>

      <TouchableOpacity
        style={[
          styles.locationButton,
          !locationPermission && styles.locationButtonDisabled,
        ]}
        onPress={handleLocationFocus}
      >
        <Ionicons
          name="navigate"
          size={24}
          color={locationPermission ? "#0366d6" : "#aaaaaa"}
        />
      </TouchableOpacity>

      <View style={styles.downloadContainer}>
        {isDownloading ? (
          <View style={styles.progressContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.progressText}>
              Downloading... ({Math.round(downloadProgress * 100)}%)
            </Text>
          </View>
        ) : (
          <Button
            title="Download Visible Region"
            onPress={handleDownload}
            disabled={isDownloading || !offlineManager}
          />
        )}
      </View>
    </View>
  );
}

// --- Styles (with additions) ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: "relative",
  },
  map: {
    flex: 1,
  },
  downloadContainer: {
    position: "absolute",
    bottom: 30,
    left: 20,
    right: 20,
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 40,
  },
  progressContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  progressText: {
    marginTop: 10,
    fontSize: 16,
  },
  locationButton: {
    position: "absolute",
    bottom: 90,
    right: 20,
    backgroundColor: "white",
    borderRadius: 30,
    width: 50,
    height: 50,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  locationButtonDisabled: {
    backgroundColor: "#f0f0f0",
  },
});
