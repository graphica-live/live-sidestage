using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Newtonsoft.Json;
using TikTokLiveSharp.Client;

// TikTok LIVE 日本語ギフト名検証 (C# / frankvHoof93 TikTokLiveSharp 0.1.4)
//
// 実測で判明した制約: TikTokHTTPClient のコンストラクタが HttpClient.Timeout を都度セットしようと
// するが、内部の HttpClient が静的(プロセス内で使い回し)らしく、1プロセスで2個目の
// TikTokLiveClient を作った瞬間に "Timeout cannot be set after client has been initalised" で
// 例外になる。そのため 1プロセス = 1回の gift-list 取得 or 1回のLIVE購読、に割り切って
// 外側をシェルループで回す設計にする(mode 引数で分岐)。
//
// 実測で判明したAPI(リフレクションで確認済み):
//   TikTokLiveClient(uniqueID, ..., enableExtendedGiftInfo=true既定, clientParams: Dictionary<string,object>, lang: "en-US"既定)
//   client.AvailableGifts: Dictionary<int, TikTokGift> ( .name / .describe / .diamond_count / .id )
//   client.OnGiftRecieved: EventHandler<WebcastGiftMessage> ( .giftId / .giftDetails.giftName / .giftDetails.Describe )
//   ※ EventArgsラッパーは無く、WebcastGiftMessage自体がイベント引数として渡る

var target = Environment.GetEnvironmentVariable("TARGET_UNIQUE_ID") ?? "yu_ki_nojo";
var rawDir = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "raw");
rawDir = Path.GetFullPath(rawDir);
Directory.CreateDirectory(rawDir);

var japaneseRegex = new Regex(@"[぀-ゟ゠-ヿ一-鿿ｦ-ﾟ]");
bool LooksJapanese(string? s) => s != null && japaneseRegex.IsMatch(s);

var mode = args.Length > 0 ? args[0] : "giftlist";

if (mode == "giftlist")
{
    var key = args[1];
    var lang = args[2];
    Dictionary<string, object>? clientParams = null;
    if (args.Length > 3 && args[3] == "webcast_language_ja_jp")
    {
        clientParams = new Dictionary<string, object> { ["webcast_language"] = "ja-JP" };
    }

    var client = new TikTokLiveClient(
        uniqueID: target,
        clientParams: clientParams,
        processInitialData: false,
        fetchRoomInfoOnConnect: true,
        enableExtendedGiftInfo: true,
        lang: lang
    );

    object result;
    try
    {
        var connectTask = client.Start(null, false);
        var completed = await Task.WhenAny(connectTask, Task.Delay(20000));
        if (completed != connectTask)
        {
            result = new { key, ok = false, error = "timeout waiting for connect (20s)" };
        }
        else
        {
            await connectTask; // 例外があればここで投げる
            // enableExtendedGiftInfo によるカタログ取得が接続完了と非同期な場合に備えて少し待つ
            for (var i = 0; i < 10 && (client.AvailableGifts == null || client.AvailableGifts.Count == 0); i++)
            {
                await Task.Delay(1000);
            }

            var gifts = client.AvailableGifts;
            if (gifts == null || gifts.Count == 0)
            {
                result = new { key, ok = false, error = "AvailableGifts empty after connect (waited 10s)" };
            }
            else
            {
                var giftList = gifts.Values.ToList();
                File.WriteAllText(Path.Combine(rawDir, $"csharp-giftlist-{key}.json"), JsonConvert.SerializeObject(giftList, Formatting.Indented));
                var jaCount = giftList.Count(g => LooksJapanese(g.name));
                var sample = giftList.Take(3).Select(g => new { id = g.id, name = g.name, describe = g.describe }).ToList();
                result = new { key, ok = true, count = giftList.Count, japaneseNameCount = jaCount, sample };
            }
        }
    }
    catch (Exception e)
    {
        result = new { key, ok = false, error = e.Message };
    }
    finally
    {
        try { await client.Stop(); } catch { }
    }

    Console.WriteLine(JsonConvert.SerializeObject(result));

    var summaryPath = Path.Combine(rawDir, "csharp-giftlist-summary.json");
    var existing = File.Exists(summaryPath)
        ? JsonConvert.DeserializeObject<List<object>>(File.ReadAllText(summaryPath)) ?? new List<object>()
        : new List<object>();
    existing.Add(result);
    File.WriteAllText(summaryPath, JsonConvert.SerializeObject(existing, Formatting.Indented));
}
else if (mode == "live")
{
    var listenSeconds = args.Length > 1 ? int.Parse(args[1]) : 60;
    Console.WriteLine($"=== listening for live GiftEvent for {listenSeconds}s ===");

    var liveClient = new TikTokLiveClient(uniqueID: target, processInitialData: false, fetchRoomInfoOnConnect: true, enableExtendedGiftInfo: false, lang: "en-US");
    var eventsFile = Path.Combine(rawDir, "csharp-gift-events.jsonl");
    var seenGiftIds = new HashSet<int>();

    liveClient.OnGiftRecieved += (sender, msg) =>
    {
        seenGiftIds.Add(msg.giftId);
        var record = new
        {
            receivedAt = DateTime.UtcNow.ToString("o"),
            giftId = msg.giftId,
            giftName = msg.giftDetails?.giftName,
            describe = msg.giftDetails?.Describe,
            diamondCount = msg.giftDetails?.diamondCount,
            repeatCount = msg.repeatCount,
            repeatEnd = msg.repeatEnd,
        };
        File.AppendAllText(eventsFile, JsonConvert.SerializeObject(record) + "\n");
        Console.WriteLine($"[gift] id={msg.giftId} name={msg.giftDetails?.giftName} x{msg.repeatCount}");
    };

    try
    {
        var connectTask = liveClient.Start(null, false);
        var completed = await Task.WhenAny(connectTask, Task.Delay(20000));
        if (completed == connectTask)
        {
            await connectTask;
            Console.WriteLine("connected. listening...");
            await Task.Delay(listenSeconds * 1000);
        }
        else
        {
            Console.WriteLine("connect timeout (20s)");
        }
    }
    catch (Exception e)
    {
        Console.WriteLine($"live listen error: {e.Message}");
    }
    finally
    {
        try { await liveClient.Stop(); } catch { }
    }

    Console.WriteLine($"done. unique giftIds observed live: {seenGiftIds.Count}");
}
