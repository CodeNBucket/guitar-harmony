# guitar harmony

Play your guitar into the microphone and a small world grows around the music. It finds the key on its own, feels the mood of what you play, lights up with every note, and brings in lightning when you hit a wrong one. Everything happens in the browser; the audio never leaves your computer.

[Türkçe aşağıda](#türkçe)

## How it works

**What it uses.** It listens with two ears. The quick one is a classic pitch tracker (the McLeod method) that names a single plucked string in about 50 milliseconds. The careful one is [Basic Pitch](https://github.com/spotify/basic-pitch), a small open source neural network from Spotify that can pull apart chords and ringing notes, a little later. It runs with TensorFlow.js, and the world is drawn with WebGL.

**How it finds the key.** It never asks you. Every note you play adds to a running count, and that pattern is compared with how notes are usually spread in each of the 24 keys (12 notes, each major or minor). The chords you play and the notes in the bass get a vote too. Once one key is clearly ahead it locks in; if the song moves, it follows after a few seconds.

**How it picks the world.** How busy the playing is, whether it leans major or minor, and how colourful the chords are add up to a mood. Melancholy brings a moonlit forest, happy a sunny one, romantic the sea at sunset. You can also pick one yourself.

**What counts as a wrong note.** Being outside the key is not enough. Both ears have to hear the note clearly, it can't belong to a chord you're playing, it can't be a passing note between two others or a note that leans into the next one, and nothing counts in the first seconds after the key is found. The rule behind all of it: a false alarm is much worse than a missed slip.

**How it shows it.** No text and no score; the scene is the only feedback. Every stroke lights the world for a moment, and every note has its own colour and shape: low strings a soft glow, the middle ones a ring, the high ones a spinning star. Play well and the sun grows stronger and the leaves start to move. Play a wrong note and lightning cracks across the sky, followed by a short storm.

**How well it works.** Played correctly, 22 songs (20 test songs, each played clean and rough, plus two real recordings of the Stairway to Heaven intro) didn't get a single false alarm. Of 47 obvious mistakes slipped into the test songs, it catches 27; the ones it lets go are mostly notes that happen to fit the chord being played.

## Run it

```
npm install
npm run dev
```

Then open http://localhost:5174 in Chrome or Edge, press "play live" and allow the microphone. Play for a few seconds and the world settles in.

The tests live in `scripts/harmony`: `npm run harmony:songs` checks 20 songs for false alarms, `npm run harmony:mistakes` checks how many planted mistakes get caught, and `npm run harmony:file -- recording.wav` prints what it heard in a recording.

The demo song is the author playing the Stairway to Heaven intro.

## Credits

Basic Pitch model by Spotify, Apache 2.0 (`public/models/basic-pitch/LICENSE`).

## Türkçe

Gitarını mikrofona çal, müziğin etrafında küçük bir dünya büyüsün. Tonu kendisi bulur, çaldığının havasını anlar, her notada ışıldar, yanlış notada şimşek çaktırır. Her şey tarayıcında olur; ses bilgisayarından hiçbir yere gitmez.

**Ne kullanıyor.** Sesi iki kulakla dinliyor. Hızlı olanı klasik bir perde takipçisi (McLeod yöntemi): tek bir teli çaldığında notayı yaklaşık 50 milisaniyede söylüyor. Dikkatli olanı Spotify'ın açık kaynak Basic Pitch modeli: akorları ve üst üste tınlayan notaları ayırabilen küçük bir yapay sinir ağı, biraz daha geriden geliyor. TensorFlow.js ile çalışıyor, dünya WebGL ile çiziliyor.

**Tonu nasıl buluyor.** Sana sormuyor. Çaldığın her nota bir sayaca ekleniyor ve bu dağılım, 24 tonun (12 nota, her biri majör ya da minör) tipik nota dağılımıyla karşılaştırılıyor. Çaldığın akorlar ve basta duyulan notalar da oy veriyor. Bir ton açıkça öne geçince kilitleniyor; şarkı başka tona geçerse birkaç saniye içinde o da geçiyor.

**Dünyayı nasıl seçiyor.** Ne kadar hareketli çaldığın, majöre mi minöre mi yaslandığın ve akorların ne kadar renkli olduğu bir havaya dönüşüyor. Hüzünlüye ay ışığında orman, mutluya güneşli orman, romantiğe gün batımında deniz. İstersen kendin de seçebilirsin.

**Neyi yanlış sayıyor.** Tonun dışında olmak yetmiyor. İki kulağın da notayı net duyması gerekiyor; çaldığın akorun parçasıysa, iki nota arasında bir geçişse ya da bir sonrakine yaslanan bir süsse affediliyor; ton yeni bulunduysa ilk saniyelerde hiçbir şey sayılmıyor. Hepsinin arkasındaki kural: haksız bir uyarı, kaçan bir hatadan çok daha kötü.

**Nasıl gösteriyor.** Ekranda yazı da puan da yok; tek geri bildirim sahne. Her vuruşta dünya bir an aydınlanıyor, her notanın kendi rengi ve şekli var: kalın teller yumuşak bir ışık, ortadakiler bir halka, inceler dönen bir yıldız. İyi çaldıkça güneş güçleniyor, yapraklar kıpırdıyor. Yanlış notada gökyüzünde şimşek çakıyor, ardından kısa bir fırtına geçiyor.

**Ne kadar iyi çalışıyor.** Doğru çalınan 22 şarkıda (temiz ve kirli olarak ikişer kez çalınan 20 test şarkısı ve Stairway to Heaven girişinin iki gerçek kaydı) tek bir haksız uyarı çıkmadı. Test şarkılarına bilerek eklenen 47 bariz hatadan 27'sini yakalıyor; kaçırdıkları çoğunlukla o an çalınan akora uyan notalar.

Çalıştırmak için `npm install`, sonra `npm run dev`, ardından Chrome ya da Edge'de http://localhost:5174 adresini aç.
