# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Empat model skrip ML Kit dibuang dari APK di build.gradle (lihat komentarnya
# di sana). Kelasnya jadi tidak ada saat build, dan R8 menolak kelas hilang
# meski yang menyentuhnya cuma cabang switch yang tidak pernah kita jalankan.
#
# Belum berpengaruh selama minifyEnabled = false, tapi ditulis sekarang supaya
# menyalakan minify di kemudian hari tidak berubah jadi build gagal yang
# sebabnya sudah tidak ada yang ingat.
-dontwarn com.google.mlkit.vision.text.chinese.**
-dontwarn com.google.mlkit.vision.text.devanagari.**
-dontwarn com.google.mlkit.vision.text.japanese.**
-dontwarn com.google.mlkit.vision.text.korean.**
