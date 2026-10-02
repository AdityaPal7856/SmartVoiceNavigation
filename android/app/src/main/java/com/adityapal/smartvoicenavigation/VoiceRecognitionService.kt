package com.adityapal.smartvoicenavigation

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat

class VoiceRecognitionService : Service() {

    companion object {
        const val CHANNEL_ID = "smart_voice_navigation"
        const val NOTIFICATION_ID = 1001

        const val ACTION_START = "START_VOICE_SERVICE"
        const val ACTION_STOP = "STOP_VOICE_SERVICE"

        const val ACTION_VOICE_RESULT =
            "com.adityapal.smartvoicenavigation.VOICE_RESULT"

        const val EXTRA_TEXT = "text"
    }

    private var speechRecognizer: SpeechRecognizer? = null
    private var isListening = false

    override fun onCreate() {
        super.onCreate()

        createNotificationChannel()

        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this)

        speechRecognizer?.setRecognitionListener(
            object : RecognitionListener {

                override fun onReadyForSpeech(params: Bundle?) {
                    isListening = true
                }

                override fun onBeginningOfSpeech() {
                    isListening = true
                }

                override fun onRmsChanged(rmsdB: Float) {
                    // Optional microphone level
                }

                override fun onBufferReceived(buffer: ByteArray?) {
                    // Not required
                }

                override fun onEndOfSpeech() {
                    isListening = false
                }

                override fun onError(error: Int) {
                    isListening = false

                    // Restart after a short delay for recoverable errors.
                    if (isServiceRunning()) {
                        android.os.Handler(mainLooper).postDelayed(
                            {
                                startListening()
                            },
                            700
                        )
                    }
                }

                override fun onResults(results: Bundle?) {
                    isListening = false

                    val matches =
                        results?.getStringArrayList(
                            SpeechRecognizer.RESULTS_RECOGNITION
                        )

                    val text = matches?.firstOrNull()?.trim()

                    if (!text.isNullOrEmpty()) {
                        sendVoiceResult(text)
                    }

                    if (isServiceRunning()) {
                        android.os.Handler(mainLooper).postDelayed(
                            {
                                startListening()
                            },
                            400
                        )
                    }
                }

                override fun onPartialResults(
                    partialResults: Bundle?
                ) {
                    // Final results are used for navigation commands.
                }

                override fun onEvent(
                    eventType: Int,
                    params: Bundle?
                ) {
                    // Not required
                }
            }
        )
    }

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int
    ): Int {

        when (intent?.action) {

            ACTION_START -> {
                startForeground(
                    NOTIFICATION_ID,
                    createNotification()
                )

                startListening()
            }

            ACTION_STOP -> {
                stopListening()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }

        return START_STICKY
    }

    private fun startListening() {

        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            return
        }

        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
            ActivityCompat.checkSelfPermission(
                this,
                Manifest.permission.RECORD_AUDIO
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        if (isListening) {
            return
        }

        try {

            val intent = Intent(
                RecognizerIntent.ACTION_RECOGNIZE_SPEECH
            ).apply {

                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                )

                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE,
                    "hi-IN"
                )

                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE,
                    "hi-IN"
                )

                putExtra(
                    RecognizerIntent.EXTRA_PARTIAL_RESULTS,
                    false
                )

                putExtra(
                    RecognizerIntent.EXTRA_MAX_RESULTS,
                    3
                )
            }

            speechRecognizer?.startListening(intent)

        } catch (e: Exception) {
            isListening = false
        }
    }

    private fun stopListening() {

        try {
            speechRecognizer?.stopListening()
            speechRecognizer?.cancel()
        } catch (_: Exception) {
        }

        isListening = false
    }

    private fun sendVoiceResult(text: String) {

        val intent = Intent(ACTION_VOICE_RESULT).apply {
            setPackage(packageName)
            putExtra(EXTRA_TEXT, text)
        }

        sendBroadcast(intent)
    }

    private fun createNotificationChannel() {

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {

            val channel = NotificationChannel(
                CHANNEL_ID,
                "Smart Voice Navigation",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description =
                    "Background voice navigation service"
            }

            val manager =
                getSystemService(
                    NotificationManager::class.java
                )

            manager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(): Notification {

        val launchIntent =
            packageManager.getLaunchIntentForPackage(
                packageName
            )

        val pendingIntent =
            PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or
                        PendingIntent.FLAG_IMMUTABLE
            )

        return NotificationCompat.Builder(
            this,
            CHANNEL_ID
        )
            .setContentTitle(
                "SmartVoiceNavigation"
            )
            .setContentText(
                "Voice navigation is active"
            )
            .setSmallIcon(
                android.R.drawable.ic_btn_speak_now
            )
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setCategory(
                NotificationCompat.CATEGORY_SERVICE
            )
            .build()
    }

    private fun isServiceRunning(): Boolean {
        return true
    }

    override fun onDestroy() {

        stopListening()

        speechRecognizer?.destroy()
        speechRecognizer = null

        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }
}