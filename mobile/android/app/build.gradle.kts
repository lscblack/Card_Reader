import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing: android/key.properties (storeFile, storePassword, keyAlias, keyPassword) or the
// env vars NFC_KEYSTORE_PATH, NFC_KEYSTORE_PASSWORD, NFC_KEY_ALIAS, NFC_KEY_PASSWORD (CI).
// key.properties and *.jks are git-ignored (android/.gitignore). See mobile/README.md.
val keystoreProperties = Properties().apply {
    val f = rootProject.file("key.properties")
    if (f.exists()) FileInputStream(f).use { load(it) }
}

fun signingValue(property: String, env: String): String? =
    (keystoreProperties.getProperty(property) ?: System.getenv(env))?.trim()?.takeIf { it.isNotEmpty() }

val releaseStorePath = signingValue("storeFile", "NFC_KEYSTORE_PATH")
val releaseStorePassword = signingValue("storePassword", "NFC_KEYSTORE_PASSWORD")
val releaseKeyAlias = signingValue("keyAlias", "NFC_KEY_ALIAS")
val releaseKeyPassword = signingValue("keyPassword", "NFC_KEY_PASSWORD")
// Relative paths are resolved against android/ (where key.properties lives).
val releaseStoreFile = releaseStorePath?.let { if (File(it).isAbsolute) File(it) else rootProject.file(it) }
val hasReleaseKey = releaseStoreFile != null && releaseStoreFile.exists() &&
    releaseStorePassword != null && releaseKeyAlias != null && releaseKeyPassword != null

android {
    namespace = "net.nexventures.nfc_terminal"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "net.nexventures.nfc_terminal"
        // nfc_manager 4.x and flutter_secure_storage 11.x require API 24+.
        minSdk = maxOf(24, flutter.minSdkVersion)
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = releaseStoreFile
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            // Without a release keystore, fall back to the debug key so existing build pipelines
            // keep working — with a loud warning: such an APK must not be distributed.
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    // FileProvider for vCard hand-off (normally already present transitively).
    implementation("androidx.core:core:1.13.1")
    // JVM unit tests for the HCE token/APDU logic (src/test/kotlin).
    testImplementation("junit:junit:4.13.2")
}

gradle.taskGraph.whenReady {
    if (!hasReleaseKey && allTasks.any { it.project == project && it.name.contains("Release") }) {
        val why = when {
            releaseStorePath == null -> "no android/key.properties and no NFC_KEYSTORE_PATH"
            releaseStoreFile?.exists() != true -> "keystore not found: $releaseStoreFile"
            else -> "incomplete signing settings (storePassword, keyAlias, keyPassword)"
        }
        logger.warn(
            "WARNING: NFC Terminal release build is signed with the DEBUG key ($why). " +
                "Do not publish this APK — see mobile/README.md \"Release signing\"."
        )
    }
}
