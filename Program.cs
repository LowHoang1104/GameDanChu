using GameDanChu.Hubs;

var builder = WebApplication.CreateBuilder(args);

// Cấu hình SignalR
builder.Services.AddSignalR(options =>
{
    options.EnableDetailedErrors = true;
    options.KeepAliveInterval = TimeSpan.FromSeconds(15);
    options.ClientTimeoutInterval = TimeSpan.FromSeconds(60);
});

// Cấu hình Kestrel: trên local dùng port 5000, trên Azure để runtime tự gán port
if (builder.Environment.IsDevelopment())
{
    builder.WebHost.UseUrls("http://0.0.0.0:5000");
}

var app = builder.Build();

// Serve static files từ wwwroot
app.UseDefaultFiles(); // Tự động serve index.html
app.UseStaticFiles();

// Map SignalR hub
app.MapHub<GameHub>("/gamehub");

Console.WriteLine("╔══════════════════════════════════════════════╗");
Console.WriteLine("║   🎮 Game Dân Chủ - Server đang chạy!       ║");
Console.WriteLine("║                                              ║");
Console.WriteLine("║   Local:  http://localhost:5000               ║");
Console.WriteLine("║   LAN:    http://<IP-máy-bạn>:5000           ║");
Console.WriteLine("║                                              ║");
Console.WriteLine("║   Host:   /host.html                         ║");
Console.WriteLine("║   Player: /player.html                       ║");
Console.WriteLine("╚══════════════════════════════════════════════╝");

app.Run();
