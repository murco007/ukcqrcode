# ukcqrcode Windows USB print bridge. Keep this window open while printing.
# Uses the already installed Windows receipt-printer queue, not WebUSB.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$queues = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters)
if ($queues.Count -eq 0) { throw 'No Windows printer queues. Install the CP-Q1UN driver first.' }
Write-Host 'ukcqrcode Windows print bridge v1.0'
for ($idx = 0; $idx -lt $queues.Count; $idx++) { Write-Host ("[{0}] {1}" -f ($idx + 1), $queues[$idx]) }
$choice = 0
if (-not [int]::TryParse((Read-Host 'Select receipt printer number (CP-Q1UN / PrinterPOS-80)'), [ref]$choice) -or $choice -lt 1 -or $choice -gt $queues.Count) { throw 'Invalid printer number.' }
$printerName = $queues[$choice - 1]
$randomBytes = New-Object byte[] 24
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($randomBytes)
$rng.Dispose()
$pairToken = [BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
$journalPath = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ukcqrcodePrint'
[IO.Directory]::CreateDirectory($journalPath) | Out-Null
$source = @'
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.ComponentModel;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
public static class ukcqrcodePrintBridge {
 const string Origin = "https://murco007.github.io";
 static JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 12000000 };
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public class DocInfo {
  [MarshalAs(UnmanagedType.LPWStr)] public string Name;
  [MarshalAs(UnmanagedType.LPWStr)] public string Output;
  [MarshalAs(UnmanagedType.LPWStr)] public string Type;
 }
 [DllImport("winspool.drv",EntryPoint="OpenPrinterW",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern bool OpenPrinter(string name,out IntPtr handle,IntPtr defaults);
 [DllImport("winspool.drv",EntryPoint="StartDocPrinterW",CharSet=CharSet.Unicode,SetLastError=true)]
 static extern int StartDocPrinter(IntPtr handle,int level,[In] DocInfo info);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool StartPagePrinter(IntPtr handle);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool WritePrinter(IntPtr handle,IntPtr bytes,int count,out int written);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool EndPagePrinter(IntPtr handle);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool EndDocPrinter(IntPtr handle);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool AbortPrinter(IntPtr handle);
 [DllImport("winspool.drv",SetLastError=true)] static extern bool ClosePrinter(IntPtr handle);
 static void Check(bool ok) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
 static int Print(string printer, byte[] bytes) {
  IntPtr handle; Check(OpenPrinter(printer,out handle,IntPtr.Zero));
  bool started=false;
  try {
   int job=StartDocPrinter(handle,1,new DocInfo { Name="ukcqrcode receipt", Type="RAW" });
   if(job==0)throw new Win32Exception(Marshal.GetLastWin32Error());
   started=true;Check(StartPagePrinter(handle));
   IntPtr buffer=Marshal.AllocHGlobal(bytes.Length);
   try {
    Marshal.Copy(bytes,0,buffer,bytes.Length);
    int offset=0;
    while(offset<bytes.Length) {
     int written;Check(WritePrinter(handle,IntPtr.Add(buffer,offset),bytes.Length-offset,out written));
     if(written<=0)throw new IOException("Printer accepted zero bytes.");
     offset+=written;
    }
   } finally { Marshal.FreeHGlobal(buffer); }
   Check(EndPagePrinter(handle));Check(EndDocPrinter(handle));started=false;return job;
  } finally { if(started)AbortPrinter(handle);ClosePrinter(handle); }
 }
 static string Text(IDictionary<string,object> obj,string key) {
  object value;return obj.TryGetValue(key,out value)&&value is string?(string)value:"";
 }
 static void Reply(NetworkStream stream,int status,object value,bool cors) {
  byte[] body=Encoding.UTF8.GetBytes(Json.Serialize(value));
  string headers="HTTP/1.1 "+status+" "+(status==200?"OK":status==204?"No Content":"Error")+"\r\n"+
   "Content-Type: application/json; charset=utf-8\r\nContent-Length: "+(status==204?0:body.Length)+"\r\nConnection: close\r\nCache-Control: no-store\r\n";
  if(cors) headers+="Access-Control-Allow-Origin: "+Origin+"\r\nVary: Origin\r\n"+
   "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-ukcqrcode-Token\r\nAccess-Control-Allow-Private-Network: true\r\n";
  byte[] head=Encoding.ASCII.GetBytes(headers+"\r\n");stream.Write(head,0,head.Length);
  if(status!=204)stream.Write(body,0,body.Length);
 }
 public static void Run(string printer,string token,string directory) {
  var listener=new TcpListener(IPAddress.Loopback,17888);
  listener.Start();
  Console.WriteLine("Printer: "+printer);
  Console.WriteLine("Pairing code: "+token);
  Console.WriteLine("Open staff page, press Windows USB connection, enter this code.");
  Console.WriteLine("Keep this window open. Ctrl+C stops the bridge.");
  while(true) {
   using(var client=listener.AcceptTcpClient()) {
    client.ReceiveTimeout=15000;client.SendTimeout=15000;
    using(var stream=client.GetStream()) {
     bool cors=false;
     try {
      var head=new List<byte>();
      while(head.Count<16384) {
       int one=stream.ReadByte();if(one<0)throw new IOException("Incomplete headers.");
       head.Add((byte)one);int n=head.Count;
       if(n>=4&&head[n-4]==13&&head[n-3]==10&&head[n-2]==13&&head[n-1]==10)break;
      }
      if(head.Count>=16384)throw new IOException("Headers too large.");
      string[] lines=Encoding.ASCII.GetString(head.ToArray()).Split(new string[]{"\r\n"},StringSplitOptions.None);
      var headers=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
      for(int i=1;i<lines.Length;i++){int colon=lines[i].IndexOf(':');if(colon>0){string k=lines[i].Substring(0,colon).Trim();if(headers.ContainsKey(k))throw new IOException("Duplicate header.");headers[k]=lines[i].Substring(colon+1).Trim();}}
      string host;headers.TryGetValue("Host",out host);
      string origin;headers.TryGetValue("Origin",out origin);cors=origin==Origin;
      if(!cors||host!="127.0.0.1:17888"){Reply(stream,403,new {error="Site or host not allowed."},false);continue;}
      string[] request=lines[0].Split(' ');if(request.Length!=3)throw new IOException("Invalid request.");
      if(request[0]=="OPTIONS"){Reply(stream,204,null,true);continue;}
      string supplied;headers.TryGetValue("X-ukcqrcode-Token",out supplied);
      if(supplied!=token){Reply(stream,401,new {error="Pairing code invalid. Copy the code from the print bridge window."},true);continue;}
      if(request[0]=="GET"&&request[1]=="/status"){Reply(stream,200,new {ok=true,printer=printer,version="1.0"},true);continue;}
      if(request[0]!="POST"||request[1]!="/print"){Reply(stream,404,new {error="Unknown route."},true);continue;}
      string contentType;headers.TryGetValue("Content-Type",out contentType);
      string rawLength;headers.TryGetValue("Content-Length",out rawLength);int length;
      if(contentType==null||!contentType.StartsWith("application/json",StringComparison.OrdinalIgnoreCase)||headers.ContainsKey("Transfer-Encoding")||!int.TryParse(rawLength,out length)||length<1||length>12000000)throw new IOException("Invalid body.");
      var body=new byte[length];int offset=0;
      while(offset<length){int count=stream.Read(body,offset,length-offset);if(count<=0)throw new IOException("Incomplete body.");offset+=count;}
      var obj=Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(body));
      string id=Text(obj,"id");string encoded=Text(obj,"bytes");
      if(id.Length<1||id.Length>160)throw new IOException("Invalid job id.");
      byte[] bytes=Convert.FromBase64String(encoded);
      if(bytes.Length<2||bytes.Length>8000000||bytes[0]!=27||bytes[1]!=64)throw new IOException("Invalid receipt.");
      string name, fingerprint;
      using(var sha=SHA256.Create()){
       name=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(id))).Replace("-","");
       fingerprint=BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","");
      }
      string journal=Path.Combine(directory,name+".json");
      if(File.Exists(journal)) {
       var prior=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(journal));
       if(Text(prior,"printer")!=printer||Text(prior,"fingerprint")!=fingerprint){Reply(stream,409,new {error="Job id already used with a different printer or receipt."},true);continue;}
       if(Text(prior,"state")=="sent"){Reply(stream,200,new {ok=true,duplicate=true,printer=printer},true);continue;}
       Reply(stream,409,new {error="Previous print may be partial. Check paper and use manual reprint."},true);continue;
      }
      File.WriteAllText(journal,Json.Serialize(new {state="sending",printer=printer,fingerprint=fingerprint}));
      int spoolId=Print(printer,bytes);
      File.WriteAllText(journal,Json.Serialize(new {state="sent",printer=printer,fingerprint=fingerprint,spoolId=spoolId}));
      Console.WriteLine(DateTime.Now.ToString("HH:mm:ss")+" queued "+id+" Windows job "+spoolId);
      Reply(stream,200,new {ok=true,printer=printer,spoolId=spoolId},true);
     } catch(Exception error) {
      Console.WriteLine("Print request: "+error.Message);
      try{Reply(stream,400,new {error=error.Message},cors);}catch{}
     }
    }
   }
  }
 }
}
'@
Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.dll', 'System.Core.dll', 'System.Web.Extensions.dll'
[ukcqrcodePrintBridge]::Run($printerName, $pairToken, $journalPath)

