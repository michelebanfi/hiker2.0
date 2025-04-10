import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  Button,
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  SafeAreaView, // Added SafeAreaView import
} from "react-native";
// Import hook, MapLibreGL might still be needed for constants like OfflinePackDownloadState if used here
import MapLibreGL, { OfflineManager } from "@maplibre/maplibre-react-native";
import { useFocusEffect } from "@react-navigation/native";

// Interfaces (same as before)
interface OfflinePackMetadata {
  name: string;
  downloaded_at?: number;
  size?: number; // Added size property
}
interface OfflinePack {
  name: string; // Internal unique ID
  bounds: [[number, number], [number, number]];
  metadata: OfflinePackMetadata | null; // Parsed metadata object
  size?: number; // Added size property at top level
}

export default function TabTwoScreen() {
  const offlineManager = OfflineManager;
  const [packs, setPacks] = useState<OfflinePack[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false); // For pull-to-refresh

  // Helper function to format bytes into human-readable size
  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  // --- Function to Fetch Packs ---
  const fetchPacks = useCallback(
    async (refreshing = false) => {
      if (!offlineManager) {
        console.log("Offline manager not available yet.");
        if (!refreshing) setIsLoading(true); // Show loading only if not refreshing
        return; // Wait for manager
      }
      console.log("Fetching offline packs...");
      if (refreshing) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      try {
        // Deep inspection of pack properties to find size
        const inspectPackForSize = (pack: any): number | null => {
          // Direct properties that might contain size
          if (typeof pack.size === "number") return pack.size;
          if (typeof pack.byteSize === "number") return pack.byteSize;
          if (typeof pack.bytes === "number") return pack.bytes;
          if (typeof pack.completedResourceSize === "number")
            return pack.completedResourceSize;
          if (
            typeof pack.completedResourceCount === "number" &&
            typeof pack.completedResourceSize === "number"
          ) {
            return pack.completedResourceSize;
          }

          // Look in pack.progress if it exists
          if (pack.progress && typeof pack.progress === "object") {
            if (typeof pack.progress.completedResourceSize === "number")
              return pack.progress.completedResourceSize;
            if (typeof pack.progress.completedSize === "number")
              return pack.progress.completedSize;
          }

          // Look for any property that might contain size information
          for (const key in pack) {
            if (
              typeof pack[key] === "number" &&
              (key.toLowerCase().includes("size") ||
                key.toLowerCase().includes("bytes"))
            ) {
              console.log(
                `Found potential size property: ${key} = ${pack[key]}`
              );
              return pack[key];
            }
          }

          return null;
        };

        // Use hook's instance
        const offlinePacksRaw = await offlineManager.getPacks();
        console.log("Raw packs:", JSON.stringify(offlinePacksRaw));

        // Dump FULL JSON of all packs for inspection
        console.log(
          "ALL PACKS FULL DETAILS:",
          JSON.stringify(offlinePacksRaw, null, 2)
        );

        const formattedPacks: OfflinePack[] = (offlinePacksRaw || []).map(
          (pack: any) => {
            let metadata: OfflinePackMetadata | null = null;

            // Check if we have the character-by-character metadata format
            if (pack._metadata && typeof pack._metadata === "object") {
              console.log("Found _metadata object, attempting to reconstruct");

              // Try to reconstruct the metadata string from individual characters
              try {
                // Get all numeric keys and sort them
                const numericKeys = Object.keys(pack._metadata)
                  .filter((key) => !isNaN(parseInt(key)))
                  .sort((a, b) => parseInt(a) - parseInt(b));

                // Reconstruct the string
                let reconstructedJson = "";
                for (const key of numericKeys) {
                  reconstructedJson += pack._metadata[key];
                }

                console.log("Reconstructed metadata JSON:", reconstructedJson);

                // Parse the reconstructed JSON
                try {
                  const parsed = JSON.parse(reconstructedJson);
                  console.log(
                    "Successfully parsed reconstructed JSON:",
                    parsed
                  );
                  metadata = parsed;

                  // Extract displayName and timestamp if available
                  if (!metadata.name && typeof parsed.name === "string") {
                    metadata.name = parsed.name;
                  }

                  if (
                    !metadata.downloaded_at &&
                    typeof parsed.downloaded_at === "number"
                  ) {
                    metadata.downloaded_at = parsed.downloaded_at;
                  }
                } catch (parseError) {
                  console.error(
                    "Error parsing reconstructed JSON:",
                    parseError
                  );
                  // Use the name directly from _metadata as fallback
                  if (pack._metadata.name) {
                    metadata = { name: pack._metadata.name };

                    // Look for a timestamp from the numeric representation
                    // This attempts to extract the timestamp from character keys
                    if (numericKeys.length > 45) {
                      // Check if we have enough characters
                      const timestampChars = [];
                      for (let i = 46; i <= 58; i++) {
                        if (pack._metadata[i.toString()]) {
                          timestampChars.push(pack._metadata[i.toString()]);
                        }
                      }
                      if (timestampChars.length > 0) {
                        const timestampStr = timestampChars.join("");
                        const timestamp = parseInt(timestampStr);
                        if (!isNaN(timestamp)) {
                          metadata.downloaded_at = timestamp;
                          console.log("Extracted timestamp:", timestamp);
                        }
                      }
                    }
                  } else {
                    metadata = { name: `Pack: ${pack.name || "Unknown"}` };
                  }
                }
              } catch (e) {
                console.error("Error while reconstructing metadata:", e);
                metadata = {
                  name:
                    pack._metadata.name || `Pack: ${pack.name || "Unknown"}`,
                };
              }
            } else {
              // Fall back to original metadata handling
              try {
                if (pack.metadata) {
                  console.log(
                    `Pack ${pack.name} metadata type:`,
                    typeof pack.metadata
                  );
                  console.log(`Pack ${pack.name} metadata:`, pack.metadata);

                  // Check if metadata is already an object
                  if (
                    typeof pack.metadata === "object" &&
                    pack.metadata !== null
                  ) {
                    metadata = pack.metadata;
                  } else if (typeof pack.metadata === "string") {
                    // Try to safely parse the string
                    try {
                      metadata = JSON.parse(pack.metadata);
                    } catch (parseError) {
                      console.error(
                        `JSON parsing error for ${pack.name}:`,
                        parseError
                      );
                      // If it starts with 'o', it might be an object notation without quotes
                      metadata = { name: `Invalid JSON: ${pack.name}` };
                    }
                  } else {
                    // Unknown type
                    metadata = { name: `Unknown type: ${pack.name}` };
                  }

                  // Ensure metadata is an object with at least a name property
                  if (typeof metadata !== "object" || metadata === null) {
                    metadata = { name: `Type error: ${pack.name}` };
                  }

                  if (!metadata.name) {
                    metadata.name = `Pack: ${pack.name}`; // Fallback name
                  }
                } else {
                  metadata = { name: `Pack: ${pack.name}` }; // Default if no metadata stored
                }
              } catch (e) {
                console.error(
                  `Error handling metadata for pack ${pack.name}:`,
                  e
                );
                metadata = { name: `Error: ${pack.name}` };
              }
            }

            // Estimate size: Let's use a conservative estimate based on metadata size
            // since we don't have actual size information
            let estimatedSize = null;
            if (pack._metadata) {
              // A very rough estimate: 10KB per tile region as base + metadata size
              const metadataStr = JSON.stringify(pack._metadata);
              estimatedSize = 10 * 1024 + metadataStr.length * 2;
              console.log(
                `Estimated size for ${
                  metadata?.name || pack.name
                }: ${estimatedSize} bytes`
              );
            }

            return {
              name: pack.name, // Internal name
              bounds: pack.bounds || (pack.pack ? pack.pack.bounds : null),
              metadata: metadata,
              size: estimatedSize, // Use our estimated size
            };
          }
        );

        setPacks(formattedPacks);
        console.log("Formatted packs:", formattedPacks);
      } catch (error: any) {
        console.error("Error fetching offline packs:", error);
        Alert.alert("Error", `Could not fetch offline packs. ${error.message}`);
        setPacks([]);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [offlineManager]
  ); // Dependency on offlineManager instance

  // --- Use useFocusEffect to refresh list when tab becomes active ---
  useFocusEffect(
    useCallback(() => {
      fetchPacks(); // Fetch packs when the screen comes into focus
    }, [fetchPacks]) // Re-run effect if fetchPacks changes
  );

  // --- Function to Delete a Pack ---
  const handleDeletePack = (packName: string, displayName: string) => {
    if (!offlineManager) {
      Alert.alert("Error", "Offline manager not available.");
      return;
    }
    Alert.alert(
      "Confirm Deletion",
      `Are you sure you want to delete the offline region "${displayName}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            console.log("Attempting to delete pack:", packName);
            setIsLoading(true); // Use main loading indicator
            try {
              // Use hook's instance
              await offlineManager.deletePack(packName);
              Alert.alert("Success", `Region "${displayName}" deleted.`);
              // Refresh the list silently (or show loader briefly)
              fetchPacks(); // This will set isLoading=true then false
            } catch (error: any) {
              console.error(`Error deleting pack ${packName}:`, error);
              Alert.alert("Error", `Could not delete pack. ${error.message}`);
              setIsLoading(false); // Ensure loader stops on error
            }
          },
        },
      ]
    );
  };

  // --- Render List Item ---
  const renderItem = ({ item }: { item: OfflinePack }) => (
    <View style={styles.listItem}>
      <View style={styles.itemTextContainer}>
        {/* Use metadata name, fallback to internal name */}
        <Text style={styles.itemTitle}>{item.metadata?.name || item.name}</Text>
        {item.metadata?.downloaded_at && (
          <Text style={styles.itemSubtitle}>
            Downloaded:{" "}
            {new Date(item.metadata.downloaded_at).toLocaleDateString()}
          </Text>
        )}
        {/* Size information removed as requested */}
        {/* Display internal name for debugging if needed */}
        {/* <Text style={styles.itemSubtitle}>ID: {item.name}</Text> */}
      </View>
      <Button
        title="Delete"
        color={Platform.OS === "ios" ? "#FF3B30" : "#FF0000"}
        onPress={() =>
          handleDeletePack(item.name, item.metadata?.name || item.name)
        }
        disabled={isLoading || isRefreshing} // Disable during any loading state
      />
    </View>
  );

  // --- Pull to Refresh Handler ---
  const onRefresh = useCallback(() => {
    fetchPacks(true); // Call fetchPacks with refreshing flag
  }, [fetchPacks]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header moved into FlatList's ListHeaderComponent for better scroll behaviour */}
      {isLoading && packs.length === 0 && !isRefreshing ? (
        <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
      ) : (
        <FlatList
          data={packs}
          renderItem={renderItem}
          keyExtractor={(item) => item.name}
          style={styles.list}
          ListHeaderComponent={
            <Text style={styles.header}>Downloaded Offline Regions</Text>
          }
          ListEmptyComponent={
            !isLoading && !isRefreshing ? ( // Only show empty text when not loading/refreshing
              <Text style={styles.emptyText}>
                No offline regions downloaded yet. Pull down to refresh.
              </Text>
            ) : null
          }
          // Add Pull-to-Refresh
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor="#007AFF" // iOS spinner color
              colors={["#007AFF"]} // Android spinner color(s)
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

// --- Styles (minor adjustments for FlatList header/empty) ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  header: {
    fontSize: 20,
    fontWeight: "bold",
    marginVertical: 20, // Add vertical margin
    marginHorizontal: 20, // Add horizontal margin
    textAlign: "center",
  },
  loader: {
    flex: 1, // Center loader if it's the only thing shown initially
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    textAlign: "center",
    marginTop: 50,
    marginHorizontal: 20, // Add horizontal margin
    fontSize: 16,
    color: "#666",
  },
  list: {
    flex: 1, // Ensure list takes up available space
  },
  listItem: {
    backgroundColor: "#ffffff",
    padding: 15,
    marginVertical: 5, // Vertical space between items
    marginHorizontal: 20, // Horizontal margin for list items
    borderRadius: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#eee",
  },
  itemTextContainer: {
    flex: 1,
    marginRight: 10,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "500",
  },
  itemSubtitle: {
    fontSize: 12,
    color: "#888",
    marginTop: 4,
  },
});
