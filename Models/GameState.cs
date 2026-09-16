using System.Collections.Concurrent;

namespace GameDanChu.Models;

// ── Enum trạng thái game ──
public enum GameStatus
{
    Lobby,          // Đang chờ người chơi
    Playing,        // Game đã bắt đầu (giữa các round)
    RoundActive,    // Round đang diễn ra, người chơi đang vote
    RoundEnded,     // Round kết thúc, hiển thị kết quả
    FinalActive,    // Vòng cuối đang diễn ra
    FinalEnded,     // Vòng cuối kết thúc
    Finished        // Game hoàn tất
}

// ── Thông tin người chơi ──
public class Player
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8]; // 8 ký tự
    public string Name { get; set; } = "";
    public string ConnectionId { get; set; } = "";
    public bool IsActive { get; set; } = true;
    public string? CurrentChoice { get; set; }  // "A" hoặc "B"
    public bool HasVoted { get; set; }
    public int? EliminatedAtRound { get; set; }
}

// ── Phòng game ──
public class GameRoom
{
    public string RoomCode { get; set; } = "";
    public int CurrentRound { get; set; } = 0;
    public GameStatus Status { get; set; } = GameStatus.Lobby;

    // Câu hỏi hiện tại
    public string Question { get; set; } = "";
    public string QuestionTitle { get; set; } = "";
    public string OptionA { get; set; } = "";
    public string OptionB { get; set; } = "";


    // Kết quả
    public string? Winner { get; set; }  // "A" hoặc "B"
    public bool IsFinalRound { get; set; }

    // Host
    public string HostConnectionId { get; set; } = "";

    // Danh sách người chơi (thread-safe)
    public ConcurrentDictionary<string, Player> Players { get; set; } = new();

    // Lock object cho các thao tác cần đồng bộ
    public readonly object Lock = new();


    // ── Helper methods ──

    public int TotalPlayers => Players.Count;
    public int ActivePlayers => Players.Values.Count(p => p.IsActive);
    public int EliminatedPlayers => Players.Values.Count(p => !p.IsActive);
    public int VoteCountA => Players.Values.Count(p => p.IsActive && p.HasVoted && p.CurrentChoice == "A");
    public int VoteCountB => Players.Values.Count(p => p.IsActive && p.HasVoted && p.CurrentChoice == "B");
    public int TotalVoted => Players.Values.Count(p => p.IsActive && p.HasVoted);

    /// <summary>Reset vote cho round mới</summary>
    public void ResetVotes()
    {
        foreach (var player in Players.Values)
        {
            if (player.IsActive)
            {
                player.CurrentChoice = null;
                player.HasVoted = false;
            }
        }
        Winner = null;
    }
}

// ── Lưu trữ tất cả phòng game ──
public static class GameStore
{
    public static readonly ConcurrentDictionary<string, GameRoom> Rooms = new();

    private static readonly Random _random = new();
    private const string Chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Bỏ I,O,0,1 tránh nhầm

    /// <summary>Tạo room code ngẫu nhiên 4 ký tự</summary>
    public static string GenerateRoomCode()
    {
        string code;
        do
        {
            code = new string(Enumerable.Range(0, 4)
                .Select(_ => Chars[_random.Next(Chars.Length)])
                .ToArray());
        } while (Rooms.ContainsKey(code));

        return code;
    }
}
