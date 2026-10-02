package com.adityapal.smartvoicenavigation

import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class VoiceRecognitionModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "VoiceRecognition"
    }

    @ReactMethod
    fun startVoiceService() {
        val context = reactApplicationContext

        val intent = Intent(
            context,
            VoiceRecognitionService::class.java
        ).apply {
            action = VoiceRecognitionService.ACTION_START
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ContextCompat.startForegroundService(
                context,
                intent
            )
        } else {
            context.startService(intent)
        }
    }

    @ReactMethod
    fun stopVoiceService() {
        val context = reactApplicationContext

        val intent = Intent(
            context,
            VoiceRecognitionService::class.java
        ).apply {
            action = VoiceRecognitionService.ACTION_STOP
        }

        context.startService(intent)
    }
}