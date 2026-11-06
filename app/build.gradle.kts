plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.lyricplayer.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.lyricplayer.app"
        minSdk = 26
        targetSdk = 34
        // Every build on GitHub counts up: 1.0.<build number>
        val buildNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toIntOrNull() ?: 1
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
    }

    flavorDimensions += "device"
    productFlavors {
        create("phone") {
            dimension = "device"
        }
        create("tv") {
            dimension = "device"
            applicationIdSuffix = ".tv"
            versionNameSuffix = "-tv"
        }
    }

    // A fixed signing key (kept in the repo, personal use only) so each new build installs over the last one.
    signingConfigs {
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.media:media:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
}
