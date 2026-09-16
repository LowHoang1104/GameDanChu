using Microsoft.AspNetCore.SignalR;
using GameDanChu.Models;

namespace GameDanChu.Hubs;

public class GameHub : Hub
{
    private readonly ILogger<GameHub> _logger;

    public GameHub(ILogger<GameHub> logger)
    {
        _logger = logger;
    }

    // ═══════════════════════════════════════════════════════
    //  HOST METHODS
    // ═══════════════════════════════════════════════════════

    /// <summary>Host tạo phòng mới</summary>
    public async Task CreateRoom()
    {
        var code = GameStore.GenerateRoomCode();
        var room = new GameRoom
        {
            RoomCode = code,
            HostConnectionId = Context.ConnectionId
        };

        GameStore.Rooms[code] = room;
        await Groups.AddToGroupAsync(Context.ConnectionId, code);

        _logger.LogInformation("Room {Code} created by {ConnId}", code, Context.ConnectionId);
        await Clients.Caller.SendAsync("RoomCreated", code);
    }

    /// <summary>Host bắt đầu game (chuyển từ Lobby → Playing)</summary>
    public async Task StartGame(string roomCode)
    {
        if (!TryGetHostRoom(roomCode, out var room)) return;

        lock (room!.Lock)
        {
            if (room.Status != GameStatus.Lobby) return;
            room.Status = GameStatus.Playing;
        }

        _logger.LogInformation("Game started in room {Code}", roomCode);
        await Clients.Group(roomCode).SendAsync("GameStarted");
    }

    /// <summary>Host bắt đầu 1 round</summary>
    public async Task StartRound(string roomCode, string questionTitle, string question,
        string optionA, string optionB)
    {
        if (!TryGetHostRoom(roomCode, out var room)) return;

        lock (room!.Lock)
        {
            if (room.Status != GameStatus.Playing && room.Status != GameStatus.RoundEnded) return;

            room.CurrentRound++;
            room.QuestionTitle = questionTitle;
            room.Question = question;
            room.OptionA = optionA;
            room.OptionB = optionB;
            room.IsFinalRound = false;
            room.Status = GameStatus.RoundActive;
            room.ResetVotes();
        }

        _logger.LogInformation("Round {Round} started in room {Code}", room.CurrentRound, roomCode);

        await Clients.Group(roomCode).SendAsync("RoundStarted",
            room.CurrentRound, room.QuestionTitle, room.Question,
            room.OptionA, room.OptionB);
    }

    /// <summary>Host bắt đầu vòng Final</summary>
    public async Task StartFinal(string roomCode, string questionTitle, string question,
        string optionA, string optionB)
    {
        if (!TryGetHostRoom(roomCode, out var room)) return;

        lock (room!.Lock)
        {
            if (room.Status != GameStatus.Playing && room.Status != GameStatus.RoundEnded) return;

            room.CurrentRound++;
            room.QuestionTitle = questionTitle;
            room.Question = question;
            room.OptionA = optionA;
            room.OptionB = optionB;
            room.IsFinalRound = true;
            room.Status = GameStatus.FinalActive;
            room.ResetVotes();
        }

        _logger.LogInformation("Final round started in room {Code}", roomCode);

        await Clients.Group(roomCode).SendAsync("FinalStarted",
            room.CurrentRound, room.QuestionTitle, room.Question,
            room.OptionA, room.OptionB);
    }

    /// <summary>Host kết thúc round sớm (hoặc tự động gọi khi hết giờ)</summary>
    public async Task EndRound(string roomCode)
    {
        if (!TryGetHostRoom(roomCode, out var room)) return;
        await EndRoundInternal(room!);
    }

    /// <summary>Host chuyển sang round tiếp theo</summary>
    public async Task NextRound(string roomCode)
    {
        if (!TryGetHostRoom(roomCode, out var room)) return;

        lock (room!.Lock)
        {
            if (room.Status != GameStatus.RoundEnded) return;
            room.Status = GameStatus.Playing;
        }

        await Clients.Group(roomCode).SendAsync("NextRoundReady", room.ActivePlayers);
    }

    /// <summary>Host reset game</summary>
    public async Task ResetGame(string roomCode)
    {
        if (!TryGetHostRoom(roomCode, out var room)) return;

        lock (room!.Lock)
        {
            room.CurrentRound = 0;
            room.Status = GameStatus.Lobby;
            room.Question = "";
            room.QuestionTitle = "";
            room.OptionA = "";
            room.OptionB = "";
            room.Winner = null;
            room.IsFinalRound = false;

            foreach (var player in room.Players.Values)
            {
                player.IsActive = true;
                player.CurrentChoice = null;
                player.HasVoted = false;
                player.EliminatedAtRound = null;
            }
        }

        _logger.LogInformation("Game reset in room {Code}", roomCode);
        await Clients.Group(roomCode).SendAsync("GameReset");
    }

    // ═══════════════════════════════════════════════════════
    //  PLAYER METHODS
    // ═══════════════════════════════════════════════════════

    /// <summary>Người chơi tham gia phòng</summary>
    public async Task JoinRoom(string roomCode, string playerName)
    {
        roomCode = roomCode.ToUpper().Trim();
        playerName = playerName.Trim();

        if (string.IsNullOrEmpty(playerName) || playerName.Length > 20)
        {
            await Clients.Caller.SendAsync("Error", "Tên không hợp lệ (1-20 ký tự)");
            return;
        }

        if (!GameStore.Rooms.TryGetValue(roomCode, out var room))
        {
            await Clients.Caller.SendAsync("Error", "Không tìm thấy phòng");
            return;
        }

        var player = new Player
        {
            Name = playerName,
            ConnectionId = Context.ConnectionId
        };

        room.Players[player.Id] = player;
        await Groups.AddToGroupAsync(Context.ConnectionId, roomCode);

        _logger.LogInformation("Player {Name} ({Id}) joined room {Code}",
            playerName, player.Id, roomCode);

        // Gửi cho player thông tin join thành công
        await Clients.Caller.SendAsync("JoinedRoom", player.Id, roomCode, room.Status.ToString());

        // Thông báo cho cả phòng
        var playerNames = room.Players.Values.Select(p => p.Name).ToList();
        await Clients.Group(roomCode).SendAsync("PlayerJoined",
            playerName, room.TotalPlayers, playerNames);

        // Nếu game đang diễn ra, gửi state hiện tại cho player mới
        if (room.Status != GameStatus.Lobby)
        {
            await SendFullState(room, Context.ConnectionId);
        }
    }

    /// <summary>Người chơi rejoin sau khi reload trang</summary>
    public async Task Rejoin(string roomCode, string playerId)
    {
        roomCode = roomCode.ToUpper().Trim();

        if (!GameStore.Rooms.TryGetValue(roomCode, out var room))
        {
            await Clients.Caller.SendAsync("Error", "Không tìm thấy phòng");
            return;
        }

        if (!room.Players.TryGetValue(playerId, out var player))
        {
            await Clients.Caller.SendAsync("Error", "Không tìm thấy người chơi");
            return;
        }

        // Cập nhật ConnectionId mới
        var oldConnId = player.ConnectionId;
        player.ConnectionId = Context.ConnectionId;

        // Rời group cũ, join group mới
        try { await Groups.RemoveFromGroupAsync(oldConnId, roomCode); } catch { }
        await Groups.AddToGroupAsync(Context.ConnectionId, roomCode);

        _logger.LogInformation("Player {Name} ({Id}) rejoined room {Code}", player.Name, playerId, roomCode);

        await Clients.Caller.SendAsync("Rejoined", playerId, roomCode, player.Name);
        await SendFullState(room, Context.ConnectionId);
    }

    /// <summary>Người chơi vote</summary>
    public async Task Vote(string roomCode, string playerId, string choice)
    {
        roomCode = roomCode.ToUpper().Trim();
        choice = choice.ToUpper().Trim();

        if (choice != "A" && choice != "B")
        {
            await Clients.Caller.SendAsync("Error", "Lựa chọn không hợp lệ");
            return;
        }

        if (!GameStore.Rooms.TryGetValue(roomCode, out var room))
        {
            await Clients.Caller.SendAsync("Error", "Không tìm thấy phòng");
            return;
        }

        if (room.Status != GameStatus.RoundActive && room.Status != GameStatus.FinalActive)
        {
            await Clients.Caller.SendAsync("Error", "Không thể vote lúc này");
            return;
        }

        if (!room.Players.TryGetValue(playerId, out var player))
        {
            await Clients.Caller.SendAsync("Error", "Không tìm thấy người chơi");
            return;
        }

        lock (room.Lock)
        {
            if (!player.IsActive)
            {
                // Không gửi error async trong lock, set flag
                return;
            }
            if (player.HasVoted)
            {
                return;
            }

            player.CurrentChoice = choice;
            player.HasVoted = true;
        }

        _logger.LogInformation("Player {Name} voted {Choice} in room {Code}", player.Name, choice, roomCode);

        // Xác nhận cho player
        await Clients.Caller.SendAsync("VoteConfirmed", choice);

        // Gửi cập nhật vote cho Host (chỉ số lượng, không tên)
        await Clients.Client(room.HostConnectionId).SendAsync("VoteUpdated",
            room.VoteCountA, room.VoteCountB, room.TotalVoted, room.ActivePlayers);
    }

    // ═══════════════════════════════════════════════════════
    //  CONNECTION EVENTS
    // ═══════════════════════════════════════════════════════

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        // Tìm player bị disconnect
        foreach (var room in GameStore.Rooms.Values)
        {
            var player = room.Players.Values.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
            if (player != null)
            {
                _logger.LogInformation("Player {Name} disconnected from room {Code}",
                    player.Name, room.RoomCode);

                // Không xóa player, chỉ log. Họ có thể rejoin.
                var playerNames = room.Players.Values.Select(p => p.Name).ToList();
                await Clients.Group(room.RoomCode).SendAsync("PlayerDisconnected",
                    player.Name, room.TotalPlayers, playerNames);
                break;
            }

            // Kiểm tra xem có phải host disconnect không
            if (room.HostConnectionId == Context.ConnectionId)
            {
                _logger.LogWarning("Host disconnected from room {Code}", room.RoomCode);
            }
        }

        await base.OnDisconnectedAsync(exception);
    }

    // ═══════════════════════════════════════════════════════
    //  PRIVATE HELPERS
    // ═══════════════════════════════════════════════════════

    /// <summary>Validate room và quyền host</summary>
    private bool TryGetHostRoom(string roomCode, out GameRoom? room)
    {
        room = null;
        roomCode = roomCode.ToUpper().Trim();

        if (!GameStore.Rooms.TryGetValue(roomCode, out room))
            return false;

        if (room.HostConnectionId != Context.ConnectionId)
        {
            _logger.LogWarning("Non-host tried to control room {Code}", roomCode);
            return false;
        }

        return true;
    }


    /// <summary>Logic kết thúc round</summary>
    private async Task EndRoundInternal(GameRoom room)
    {

        int countA, countB;
        string winner;
        bool isFinal;

        lock (room.Lock)
        {
            if (room.Status != GameStatus.RoundActive && room.Status != GameStatus.FinalActive)
                return;

            isFinal = room.IsFinalRound;
            countA = room.VoteCountA;
            countB = room.VoteCountB;

            // Xác định bên thắng (bên có nhiều vote hơn, hòa thì A thắng)
            winner = countA >= countB ? "A" : "B";
            room.Winner = winner;

            if (isFinal)
            {
                // Vòng cuối: không loại ai
                room.Status = GameStatus.FinalEnded;
            }
            else
            {
                // Loại người chọn sai
                foreach (var player in room.Players.Values)
                {
                    if (!player.IsActive) continue;

                    // Người không vote hoặc vote bên thua → bị loại
                    if (!player.HasVoted || player.CurrentChoice != winner)
                    {
                        player.IsActive = false;
                        player.EliminatedAtRound = room.CurrentRound;
                    }
                }

                room.Status = GameStatus.RoundEnded;
            }
        }

        _logger.LogInformation("Round {Round} ended in room {Code}: A={A}, B={B}, Winner={W}",
            room.CurrentRound, room.RoomCode, countA, countB, winner);

        if (isFinal)
        {
            // Gửi kết quả final cho tất cả
            await Clients.Group(room.RoomCode).SendAsync("FinalResult",
                countA, countB, winner, room.OptionA, room.OptionB);
        }
        else
        {
            // Gửi kết quả round cho host
            await Clients.Group(room.RoomCode).SendAsync("RoundEnded",
                room.CurrentRound, countA, countB, winner,
                room.OptionA, room.OptionB,
                room.ActivePlayers, room.EliminatedPlayers);

            // Gửi kết quả riêng cho từng player
            foreach (var player in room.Players.Values)
            {
                if (string.IsNullOrEmpty(player.ConnectionId)) continue;

                bool isWinner = player.IsActive;
                string message = isWinner
                    ? "🎉 Chúc mừng! Bạn được đi tiếp!"
                    : $"😢 Bạn đã dừng ở Vòng {room.CurrentRound}";

                try
                {
                    await Clients.Client(player.ConnectionId).SendAsync("PlayerResult",
                        isWinner, message, player.CurrentChoice, winner, room.CurrentRound);
                }
                catch { }
            }
        }
    }

    /// <summary>Gửi full state cho 1 client (dùng khi rejoin)</summary>
    private async Task SendFullState(GameRoom room, string connectionId)
    {
        var state = new
        {
            room.RoomCode,
            room.CurrentRound,
            Status = room.Status.ToString(),
            room.QuestionTitle,
            room.Question,
            room.OptionA,
            room.OptionB,

            room.Winner,
            room.IsFinalRound,
            room.TotalPlayers,
            room.ActivePlayers,
            room.EliminatedPlayers,
            VoteCountA = room.VoteCountA,
            VoteCountB = room.VoteCountB,
            TotalVoted = room.TotalVoted,
            PlayerNames = room.Players.Values.Select(p => p.Name).ToList()
        };

        await Clients.Client(connectionId).SendAsync("FullState", state);
    }
}
